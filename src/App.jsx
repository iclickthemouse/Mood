import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Plus,
  Minus,
  Image as ImageIcon,
  FileText,
  Trash2,
  Pencil,
  Check,
  X,
  Copy,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Upload,
  Loader2,
  StickyNote,
  Download,
  RefreshCw,
  Sparkles,
  Settings,
  Cpu,
  Cloud,
  Server,
  Eye,
  EyeOff,
  Plug,
  SlidersHorizontal,
  Library,
  Save,
  Code2,
  HelpCircle,
  ArrowRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  History,
  RotateCcw,
  GitCompareArrows,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import moodLogo from "./assets/mood-logo.svg";
import sampleTypewriterImg from "./assets/sample-board.jpg";
import sampleSunsetImg from "./assets/sample-sunset.jpg";
import samplePlantImg from "./assets/sample-plant.jpg";

/* ------------------------------------------------------------------ *
 *  mood — infinite-canvas mood board workspace
 *  Drag reference images onto the canvas; mood analyzes each one and
 *  synthesizes the whole board into one cohesive image-to-text prompt.
 *  (Voice boards: writing samples -> skill.md style profiles are a v2
 *  deliverable. The related code below is retained but not user-facing.)
 * ------------------------------------------------------------------ */

const MODEL = "claude-sonnet-4-6";
const REGEN_DELAY = 650; // debounce before (re)generating output
const NOTE_MINIMUM = 5;

const IMAGE_WEIGHT_DEFAULT = 1.0;
const IMAGE_WEIGHT_MIN = 0.1;
const IMAGE_WEIGHT_MAX = 5.0;
const IMAGE_WEIGHT_STEP = 0.1;
const IMAGE_DIMENSION_WEIGHTS = [
  { key: "character", label: "Character" },
  { key: "style", label: "Style" },
  { key: "composition", label: "Composition" },
  { key: "lighting", label: "Lighting" },
];
const DEFAULT_DIMENSION_WEIGHTS = Object.fromEntries(
  IMAGE_DIMENSION_WEIGHTS.map((dim) => [dim.key, IMAGE_WEIGHT_DEFAULT])
);
const DEFAULT_PROMPT_FORMAT = "verbose_flux_caption";
const DEFAULT_ASPECT_RATIO = "1:1";
const STORAGE_KEY = "mood.local.v1";
const ONBOARDING_KEY = "mood.onboarded.v1";

const PROMPT_FORMATS = {
  json: "JSON",
  verbose_flux_caption: "Verbose / FLUX caption",
  ideogram_json: "Ideogram JSON",
  midjourney_tags: "Midjourney tags",
  deep_director: "Deep Director",
};

function clampImageWeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return IMAGE_WEIGHT_DEFAULT;
  return Math.min(IMAGE_WEIGHT_MAX, Math.max(IMAGE_WEIGHT_MIN, n));
}

function formatImageWeight(value) {
  return clampImageWeight(value).toFixed(1);
}

function normalizeDimensionWeights(weights = {}) {
  return IMAGE_DIMENSION_WEIGHTS.reduce(
    (next, dim) => ({
      ...next,
      [dim.key]: clampImageWeight(weights[dim.key] ?? IMAGE_WEIGHT_DEFAULT),
    }),
    {}
  );
}

function formatDimensionWeights(weights = {}) {
  const normalized = normalizeDimensionWeights(weights);
  return IMAGE_DIMENSION_WEIGHTS.map(
    (dim) => `${dim.key}:${formatImageWeight(normalized[dim.key])}`
  ).join(",");
}

function extractSubjectEntities(analysis = "") {
  const text = String(analysis)
    .replace(/#[A-Fa-f0-9]{3,8}\b/g, "")
    .replace(/\b[A-Z]{2,}\b/g, "");
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g) || [];
  const blocked = new Set([
    "Primary Colors",
    "Final Polish",
    "Draft",
    "Subject",
    "Composition",
    "Lighting",
    "Texture",
    "Palette",
    "Background",
  ]);
  const blockedTerms =
    /\b(blue|pink|red|green|yellow|orange|purple|violet|cobalt|teal|cyan|magenta|silver|gold|black|white|gray|grey|brown|beige|color|colors|palette|lighting|background|texture)\b/i;
  return [...new Set(matches.map((m) => m.trim()).filter((m) => !blocked.has(m) && !blockedTerms.test(m)))]
    .slice(0, 4);
}

function getCharacterInfluence(ref) {
  const dims = normalizeDimensionWeights(ref.dimension_weights || ref.dimensionWeights);
  return clampImageWeight(ref.weight) * clampImageWeight(dims.character);
}

/* Translate a dimension weight into an explicit steer direction. 1.0 is
 * neutral; above pulls the final result toward this reference's take on a
 * dimension, below pushes away (and the low end actively avoids it).      */
const WEIGHT_BANDS = [
  { min: 3.5, key: "dominant", dir: "toward", verb: "make this the dominant reference for" },
  { min: 2.0, key: "anchor", dir: "toward", verb: "anchor" },
  { min: 1.5, key: "strong", dir: "toward", verb: "lean strongly toward" },
  { min: 1.1, key: "prefer", dir: "toward", verb: "lean toward" },
  { min: 0.9, key: "neutral", dir: "neutral", verb: "treat as normal evidence for" },
  { min: 0.5, key: "ease", dir: "away", verb: "ease off" },
  { min: 0.0, key: "avoid", dir: "away", verb: "actively steer away from" },
];

function weightBand(value) {
  const v = clampImageWeight(value);
  return WEIGHT_BANDS.find((b) => v >= b.min) || WEIGHT_BANDS[WEIGHT_BANDS.length - 1];
}

/* ----------------------------- API ----------------------------- */

/* Provider configuration ----------------------------------------- *
 * 'anthropic' uses the in-artifact Claude API (works inside Claude.ai).
 * The others call external endpoints directly from the browser and are
 * intended for when you run mood in your own environment — inside the
 * Claude.ai sandbox they may be blocked by the network/CSP policy.      */

const PROVIDERS = {
  hosted: { label: "Mood Director hosted", icon: "sparkles", needsKey: false },
  lmstudio: { label: "LM Studio (local)", icon: "cpu", needsKey: false },
  ollama: { label: "Ollama (local)", icon: "cpu", needsKey: false },
  openai: { label: "OpenAI", icon: "cloud", needsKey: true },
  gemini: { label: "Google Gemini", icon: "cloud", needsKey: true },
  anthropic: { label: "Claude", icon: "sparkles", needsKey: false },
};

// Providers where the user supplies the compute (local server or API key).
const BYO_PROVIDERS = ["lmstudio", "ollama", "openai", "gemini", "anthropic"];

// On an https web deployment the browser blocks calls to http://localhost
// (mixed content), so local-server providers can't work there. The desktop
// build routes through native HTTP and is unaffected.
const LOCAL_PROVIDERS_BLOCKED =
  typeof window !== "undefined" &&
  !isTauri() &&
  window.location.protocol === "https:";

/* mood hosted — a vision model we run for the user (zero setup).
 * All hosted calls go through the mood proxy worker (worker/), which owns
 * the model API key server-side; the key never exists in this bundle.
 * Entry requires the beta password, exchanged for a signed 30-day token.
 * VITE_MOOD_PROXY_URL points at the deployed worker (unset = no hosted). */
const HOSTED_PROXY_URL = (import.meta.env.VITE_MOOD_PROXY_URL || "").replace(
  /\/+$/,
  ""
);
const HOSTED_AVAILABLE = !!HOSTED_PROXY_URL;
const HOSTED_TOKEN_KEY = "mood.hosted.token";

function getHostedToken() {
  if (typeof window === "undefined") return "";
  const token = window.localStorage.getItem(HOSTED_TOKEN_KEY) || "";
  const exp = Number(token.split(".")[1]);
  if (!token || !Number.isFinite(exp) || exp < Date.now()) return "";
  return token;
}

async function hostedLogin(password) {
  const res = await appFetch(`${HOSTED_PROXY_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Wrong password");
  }
  const { token } = await res.json();
  window.localStorage.setItem(HOSTED_TOKEN_KEY, token);
  return token;
}

const DEFAULT_CONFIG = {
  provider: HOSTED_AVAILABLE ? "hosted" : "lmstudio",
  openaiKey: "",
  openaiModel: "gpt-4o-mini",
  geminiKey: "",
  geminiModel: "gemini-2.5-flash",
  lmStudioUrl: "/api/lmstudio",
  lmStudioModel: "google/gemma-4-12b",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.1",
  ollamaVisionModel: "llava",
};

const EMPTY_PERSISTED_STATE = {
  boards: [],
  activeId: null,
  config: DEFAULT_CONFIG,
  promptLibrary: [],
};

function stripSecretConfig(cfg = {}) {
  return {
    ...cfg,
    openaiKey: "",
    geminiKey: "",
  };
}

function normalizePersistedConfig(cfg = {}) {
  const next = { ...DEFAULT_CONFIG, ...stripSecretConfig(cfg) };
  if (isTauri()) {
    // Desktop build has no dev proxy — reach LM Studio directly through the
    // native HTTP plugin instead of the /api/lmstudio Vite proxy path.
    if (!next.lmStudioUrl || next.lmStudioUrl === "/api/lmstudio") {
      next.lmStudioUrl = "http://localhost:1234/v1";
    }
    // The in-artifact Claude provider has no key mechanism, so it can never
    // work in the desktop build — move those configs onto the default.
    if (next.provider === "anthropic") {
      next.provider = DEFAULT_CONFIG.provider;
    }
  } else if (
    /^https?:\/\/(127\.0\.0\.1|localhost):1234\/v1\/?$/i.test(next.lmStudioUrl || "")
  ) {
    // Browser build: fold a direct LM Studio URL back onto the dev proxy path.
    next.lmStudioUrl = DEFAULT_CONFIG.lmStudioUrl;
  }
  // Migrate retired Gemini model ids to a current default.
  if (!next.geminiModel || /^gemini-(1\.5|2\.0)-/.test(next.geminiModel)) {
    next.geminiModel = DEFAULT_CONFIG.geminiModel;
  }
  // Hosted provider only works in builds that ship a hosted key.
  if (next.provider === "hosted" && !HOSTED_AVAILABLE) {
    next.provider = "lmstudio";
  }
  return next;
}

// Legacy localStorage persistence — still read for one-time migration into
// IndexedDB, and used as a last-resort fallback where IndexedDB is missing.
function loadLegacyState() {
  if (typeof window === "undefined") return EMPTY_PERSISTED_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_PERSISTED_STATE;
    const parsed = JSON.parse(raw);
    const boards = Array.isArray(parsed.boards) ? parsed.boards : [];
    const activeId =
      parsed.activeId && boards.some((b) => b.id === parsed.activeId)
        ? parsed.activeId
        : boards[0]?.id || null;
    const promptLibrary = Array.isArray(parsed.promptLibrary)
      ? parsed.promptLibrary
      : [];
    return {
      boards,
      activeId,
      promptLibrary,
      config: normalizePersistedConfig(parsed.config || {}),
    };
  } catch {
    return EMPTY_PERSISTED_STATE;
  }
}

function saveLegacyState({ boards, activeId, config, promptLibrary }) {
  if (typeof window === "undefined") return;
  const payload = {
    boards,
    activeId,
    promptLibrary,
    config: stripSecretConfig(config),
    savedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

/* --------------------- storage (IndexedDB) --------------------- *
 * Boards are stored as individual records so saves are incremental
 * and one corrupt write can't take out the whole library. Unlike
 * localStorage there is no ~5MB ceiling and browsers treat the data
 * as durable rather than clearable cache.                          */

const IDB_NAME = "mood";
const IDB_VERSION = 1;
let idbFailed = false; // flips true when IndexedDB is unusable → legacy fallback
let idbPromise = null;

function openMoodDb() {
  if (!idbPromise) {
    idbPromise = new Promise((resolve, reject) => {
      const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("boards"))
          db.createObjectStore("boards", { keyPath: "id" });
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("IndexedDB open blocked"));
    });
  }
  return idbPromise;
}

async function idbGet(store, key) {
  const db = await openMoodDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(store) {
  const db = await openMoodDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbWrite(store, fn) {
  const db = await openMoodDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    fn(tx.objectStore(store));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted"));
  });
}

async function loadPersistedStateAsync() {
  if (typeof window === "undefined") return EMPTY_PERSISTED_STATE;
  if (!window.indexedDB) {
    idbFailed = true;
    return loadLegacyState();
  }
  try {
    let boards = await idbGetAll("boards");
    const migrated = await idbGet("kv", "migrated");
    if (!boards.length && !migrated) {
      // First run on IndexedDB — pull anything the old localStorage build
      // saved. The localStorage copy is left in place as a backup.
      const legacy = loadLegacyState();
      const withPos = legacy.boards.map((b, i) => ({ ...b, pos: i }));
      if (withPos.length) {
        await idbWrite("boards", (s) => withPos.forEach((b) => s.put(b)));
      }
      await idbWrite("kv", (s) => {
        s.put(legacy.activeId, "activeId");
        s.put(stripSecretConfig(legacy.config), "config");
        s.put(legacy.promptLibrary, "promptLibrary");
        s.put(true, "migrated");
      });
      boards = withPos;
    }
    boards.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
    const [activeIdRaw, cfgRaw, libRaw] = await Promise.all([
      idbGet("kv", "activeId"),
      idbGet("kv", "config"),
      idbGet("kv", "promptLibrary"),
    ]);
    const activeId =
      activeIdRaw && boards.some((b) => b.id === activeIdRaw)
        ? activeIdRaw
        : boards[0]?.id || null;
    return {
      boards,
      activeId,
      promptLibrary: Array.isArray(libRaw) ? libRaw : [],
      config: normalizePersistedConfig(cfgRaw || {}),
    };
  } catch (e) {
    console.warn("mood: IndexedDB unavailable, falling back to localStorage", e);
    idbFailed = true;
    return loadLegacyState();
  }
}

// Incremental save: only boards whose object identity or position changed
// are rewritten; removed boards are deleted. `prev` carries the last-saved
// snapshot map between calls.
async function savePersistedStateAsync(
  { boards, activeId, config, promptLibrary },
  prev
) {
  if (typeof window === "undefined") return;
  if (idbFailed) {
    saveLegacyState({ boards, activeId, config, promptLibrary });
    return;
  }
  const seen = new Set();
  const puts = [];
  boards.forEach((b, i) => {
    seen.add(b.id);
    const p = prev.boards.get(b.id);
    if (!p || p.ref !== b || p.pos !== i) puts.push({ ...b, pos: i });
  });
  const removed = [...prev.boards.keys()].filter((id) => !seen.has(id));
  if (puts.length || removed.length) {
    await idbWrite("boards", (s) => {
      puts.forEach((b) => s.put(b));
      removed.forEach((id) => s.delete(id));
    });
  }
  await idbWrite("kv", (s) => {
    s.put(activeId, "activeId");
    s.put(stripSecretConfig(config), "config");
    s.put(promptLibrary, "promptLibrary");
  });
  prev.boards = new Map(boards.map((b, i) => [b.id, { ref: b, pos: i }]));
}

/* ------------------- board export / import --------------------- *
 * A .moodboard file is a self-contained JSON snapshot of one board,
 * images included — portable, backupable, shareable.               */

const BOARD_FILE_SCHEMA = "mood.board.v1";

function boardFileName(name) {
  const slug = (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "board"}.moodboard`;
}

async function exportBoardToFile(board) {
  const json = JSON.stringify(
    { schema: BOARD_FILE_SCHEMA, exportedAt: new Date().toISOString(), board },
    null,
    2
  );
  const filename = boardFileName(board.name);
  if (isTauri()) {
    // Native save dialog — anchor downloads aren't reliable in webviews.
    const dialog = await import("@tauri-apps/plugin-dialog");
    const fs = await import("@tauri-apps/plugin-fs");
    const path = await dialog.save({
      defaultPath: filename,
      filters: [{ name: "mood board", extensions: ["moodboard"] }],
    });
    if (!path) return false; // user cancelled
    await fs.writeTextFile(path, json);
    return true;
  }
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

// Parse a .moodboard file and return a board with fresh ids so importing
// (even into the library it came from) never collides.
function parseBoardFile(text) {
  const parsed = JSON.parse(text);
  const board =
    parsed?.schema === BOARD_FILE_SCHEMA && parsed.board
      ? parsed.board
      : Array.isArray(parsed?.items)
        ? parsed // tolerate a bare board object
        : null;
  if (!board || typeof board.name !== "string" || !Array.isArray(board.items)) {
    throw new Error("Not a mood board file");
  }
  return {
    ...board,
    id: uid(),
    pos: undefined,
    items: board.items.map((it) => ({ ...it, id: uid() })),
    outputStatus: board.output ? "ready" : "idle",
    outputError: "",
  };
}

/* In the Tauri desktop build, route HTTP through the native plugin so model
 * calls — cloud or local — bypass browser CORS and mixed-content limits
 * uniformly on macOS and Windows. In a plain browser build (e.g. GitHub
 * Pages) this is a thin pass-through to window.fetch.                       */
function isTauri() {
  return typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
}

let tauriHttpPromise = null;
async function appFetch(input, init = {}) {
  const { timeoutMs = 120000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const opts = { ...rest, signal: rest.signal || controller.signal };
  try {
    if (isTauri()) {
      if (!tauriHttpPromise) tauriHttpPromise = import("@tauri-apps/plugin-http");
      const mod = await tauriHttpPromise;
      return await mod.fetch(input, opts);
    }
    return await fetch(input, opts);
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s — is the model server running and reachable?`
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function hostedComplete({ system, text, images, maxTokens }) {
  if (!HOSTED_AVAILABLE) {
    throw new Error(
      "The hosted model isn't configured in this build — pick a provider under 'Bring your own model' in settings."
    );
  }
  const token = getHostedToken();
  if (!token) {
    throw new Error(
      "Beta access needed — enter the beta password in settings to use the hosted model."
    );
  }
  const res = await appFetch(`${HOSTED_PROXY_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ system, text, images, maxTokens }),
  });
  if (res.status === 401) {
    window.localStorage.removeItem(HOSTED_TOKEN_KEY);
    throw new Error(
      "Beta session expired — re-enter the beta password in settings."
    );
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Hosted model error (${res.status})`);
  }
  const data = await res.json();
  if (!data.text) throw new Error("Hosted model returned an empty response.");
  return data.text;
}

// Unified entry point. `images` is an array of data-URLs (may be empty).
async function runCompletion(cfg, { system, text, images = [], maxTokens = 1024 }) {
  switch (cfg.provider) {
    case "hosted":
      return hostedComplete({ system, text, images, maxTokens });
    case "openai":
      return openaiComplete(cfg, { system, text, images, maxTokens });
    case "gemini":
      return geminiComplete(cfg, { system, text, images, maxTokens });
    case "lmstudio":
      return lmStudioComplete(cfg, { system, text, images, maxTokens });
    case "ollama":
      return ollamaComplete(cfg, { system, text, images, maxTokens });
    case "anthropic":
    default:
      return anthropicComplete({ system, text, images, maxTokens });
  }
}

async function anthropicComplete({ system, text, images = [], maxTokens = 1024 }) {
  const content = [];
  for (const d of images) {
    const p = splitDataUrl(d);
    if (p)
      content.push({
        type: "image",
        source: { type: "base64", media_type: p.mediaType, data: p.data },
      });
  }
  content.push({ type: "text", text });
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: "user", content }],
  };
  if (system) body.system = system;
  const res = await appFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await errText(res)}`);
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function openaiComplete(cfg, { system, text, images = [], maxTokens }) {
  if (!cfg.openaiKey) throw new Error("Missing OpenAI API key");
  const userContent =
    images.length > 0
      ? [
          { type: "text", text },
          ...images.map((url) => ({ type: "image_url", image_url: { url } })),
        ]
      : text;
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: userContent });
  const res = await appFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.openaiKey}`,
    },
    body: JSON.stringify({ model: cfg.openaiModel, messages, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await errText(res)}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function geminiComplete(cfg, { system, text, images = [], maxTokens }) {
  if (!cfg.geminiKey) throw new Error("Missing Gemini API key");
  const parts = [{ text }];
  for (const d of images) {
    const p = splitDataUrl(d);
    if (p) parts.push({ inline_data: { mime_type: p.mediaType, data: p.data } });
  }
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(cfg.geminiModel)}:generateContent?key=${encodeURIComponent(
      cfg.geminiKey
    )}`;
  const res = await appFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await errText(res)}`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function lmStudioComplete(cfg, { system, text, images = [], maxTokens }) {
  const base = (cfg.lmStudioUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("Missing LM Studio URL");
  const effectiveMaxTokens = Math.max(
    maxTokens || 0,
    images.length > 0 ? 1800 : 3200
  );
  const userContent =
    images.length > 0
      ? [
          { type: "text", text },
          ...images.map((url) => ({ type: "image_url", image_url: { url } })),
        ]
      : text;
  const messages = [];
  if (system)
    messages.push({
      role: "system",
      content:
        system +
        "\n\nFor LM Studio, put the complete answer in the final assistant content field. Do not leave final content empty. Do not spend tokens explaining your reasoning.",
    });
  messages.push({ role: "user", content: userContent });

  const res = await appFetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.lmStudioModel || "local-model",
      messages,
      max_tokens: effectiveMaxTokens,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`LM Studio ${res.status}: ${await errText(res)}`);
  const data = await res.json();
  const message = data.choices?.[0]?.message || {};
  const content =
    (message.content || "").trim() ||
    extractLmStudioFinalContent(message.reasoning_content || "", system || "");
  if (!content) {
    throw new Error(
      "LM Studio returned empty final content. If this is a reasoning model, disable thinking or choose a non-reasoning vision model."
    );
  }
  return content;
}

function extractLmStudioFinalContent(reasoning = "", system = "") {
  const text = reasoning.trim();
  if (!text) return "";
  // The synthesis system prompt carries a single "Selected output format:"
  // marker (buildImageSynthSystem). Testing the system for bare format names
  // was a bug: it used to contain every format's spec, so the first branch
  // always matched regardless of the actual selected format.
  const fmt = (/Selected output format:\s*([a-z_]+)/i.exec(system) || [])[1] || "";
  if (fmt === "verbose_flux_caption" && /PROMPT\s*:/.test(text)) {
    return extractFromMarker(text, /PROMPT\s*:/i);
  }
  if (fmt === "deep_director" && /STYLE NAME\s*:/i.test(text)) {
    return extractFromMarker(text, /STYLE NAME\s*:/i);
  }
  if (fmt === "midjourney_tags") {
    const midjourneyMatch = /\/imagine prompt:[\s\S]+/i.exec(text);
    if (midjourneyMatch) return midjourneyMatch[0].trim();
  }
  if (fmt === "json" || fmt === "ideogram_json") {
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) return text.slice(jsonStart, jsonEnd + 1).trim();
  }
  const finalMatch =
    /Final Polish[^:]*:\*?\s*([\s\S]+)/i.exec(text) ||
    /Final Answer[^:]*:\*?\s*([\s\S]+)/i.exec(text);
  if (!finalMatch) return "";
  return finalMatch[1]
    .replace(/^\s*[*-]\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractFromMarker(text, marker) {
  const match = marker.exec(text);
  if (!match) return "";
  return text
    .slice(match.index)
    .replace(/^\s*[*-]\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Open a URL (or lmstudio:// deep link) in the system browser / handler.
// In the desktop build the webview can't navigate externally, so we go
// through the opener plugin; in the browser a plain window.open works.
async function openExternal(url) {
  if (isTauri()) {
    try {
      const mod = await import("@tauri-apps/plugin-opener");
      await mod.openUrl(url);
      return;
    } catch {
      /* fall through to window.open */
    }
  }
  window.open(url, "_blank", "noopener");
}

async function listLmStudioModels(baseUrl) {
  const base = (baseUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("Missing LM Studio URL");
  const res = await appFetch(`${base}/models`);
  if (!res.ok) throw new Error(`LM Studio ${res.status}: ${await errText(res)}`);
  const data = await res.json();
  return (data.data || []).map((model) => model.id).filter(Boolean);
}

async function ollamaComplete(cfg, { system, text, images = [], maxTokens }) {
  const base = (cfg.ollamaUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("Missing Ollama URL");
  const model = images.length > 0 ? cfg.ollamaVisionModel : cfg.ollamaModel;
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  const userMsg = { role: "user", content: text };
  if (images.length > 0) {
    userMsg.images = images.map((d) => splitDataUrl(d)?.data).filter(Boolean);
  }
  messages.push(userMsg);
  const res = await appFetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { num_predict: maxTokens },
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await errText(res)}`);
  const data = await res.json();
  return (data.message?.content || "").trim();
}

async function errText(res) {
  const t = await res.text().catch(() => "");
  return t.slice(0, 180) || res.statusText;
}

const IMAGE_ANALYSIS_SYSTEM = `You analyze a single reference image for a visual mood board.

Return one flowing plain-text passage (no preamble, no headings, no markdown, no bullet lists). Use as many sentences as the image genuinely needs — a dense poster full of text deserves far more coverage than a simple texture study. Cover every applicable dimension below. Be specific, concrete, and evocative; do not pad with filler once the image is fully described.

1. TYPOGRAPHY / TEXT — never skip this check. If ANY text, lettering, numbers, logos, watermarks, or typographic elements appear in the image:
   • Transcribe every word EXACTLY as written, preserving spelling, capitalization, punctuation, and line breaks. Wrap each transcription in quotation marks.
   • Describe the typeface style (serif, sans-serif, script, display, hand-lettered, 3D extruded, neon, etc.), weight (bold, light, condensed), color, size relative to the frame, placement/position, and any effects (drop shadow, outline, glow, distortion, perspective warp).
   • If there is NO visible text, do not mention typography at all — do not guess or hallucinate text.

2. CULTURAL & STYLE REFERENCES — identify recognizable visual lineages:
   • If — and only if — the image clearly evokes a specific franchise, film, show, game, artist, studio, movement, or brand, name it precisely; a generic label like "3D animation" is not enough when a specific reference is identifiable.
   • Note recognizable characters, mascots, parodies, or homages and name them.
   • Never force a reference. If nothing specific is identifiable, describe the style in plain visual terms instead of guessing.

3. SUBJECT & CHARACTER — describe the primary subject(s): species/type, pose, expression, costume/accessories, distinguishing features. If the subject is a known or identifiable character (real or fictional), name them.
   • When a person is present, the person IS the primary subject. Describe their pose, expression, wardrobe, and every object they hold or interact with — including weapons, drinks, devices, and branded products. A branded object someone is holding is a prop in their scene, never the subject itself.
   • Transcribing text or logos never replaces describing the scene around them. This is neutral reference documentation for art direction — describe everything visible exactly as it appears.

4. COMPOSITION & FRAMING — camera angle, distance, depth of field, subject placement, negative space, perspective.

5. COLOR & PALETTE — dominant and accent colors, temperature, saturation level, palette mood.

6. TEXTURES & MATERIALS — surface qualities, material contrasts, tactile impressions.

7. LIGHTING — source direction, quality (hard/soft), contrast, atmosphere effects (rays, volumetric, caustics, haze).

8. MOOD & ATMOSPHERE — emotional tone, energy level, narrative feeling.

9. MEDIUM & RENDER STYLE — 3D render, photograph, illustration, oil paint, vector, mixed media, pixel art, etc. Note the fidelity level and finish quality.

Every applicable dimension must be covered — order does not matter, completeness does. Fuse naturally — do not use numbers or labels in the output.`;

const IMAGE_SYNTH_SYSTEM = `You are the Mood Director synthesis agent. You synthesize one image board into one precise image-generation prompt.

The user may set a weight on each image. Weight is relative synthesis influence, not analysis truth. Default weight is 1.0. Higher-weight images should steer the board more strongly. Lower-weight images should contribute accents, secondary details, or narrow supporting cues.

Weight scale:
- 0.1-0.4: whisper influence. Use only tiny accents that do not fight the board.
- 0.5-0.9: support influence. Use for secondary palette, texture, mood, or detail.
- 1.0: normal influence. Treat as standard evidence.
- 1.1-1.9: preferred influence. Use to break close ties.
- 2.0-3.4: anchor influence. Let it lead subject, composition, light, palette, atmosphere, or style when conflicts appear.
- 3.5-5.0: dominant influence. Make it the main art-direction reference and make lower-weight images orbit around it.

Weight rules:
- Never multiply words mechanically. Weight affects decisions, not prompt length.
- Do not invent details because an image has high weight. Amplify only observable traits.
- If a high-weight image is an outlier, treat it as an intentional pivot, not a mistake. Translate its strongest usable trait into the final direction.
- Several low-weight images can outweigh one high-weight image only when they repeat the same central trait and the high-weight image does not clearly contradict user intent.
- If user intent conflicts with weights, user intent wins.
- Do not expose weight values in non-JSON outputs. Use them silently.

Each image may also include dimension_weights for character, style, composition, and lighting. Treat these as dimension-specific influence controls layered on top of the image's overall weight:
- character controls subject identity, figure/face/body cues, styling of people or primary subjects, and recognizable character traits.
- style controls medium, genre, finish, era, graphic language, fashion/editorial feel, and overall aesthetic.
- composition controls crop, framing, camera distance, pose, subject placement, negative space, perspective, and layout.
- lighting controls light source, contrast, exposure, shadow behavior, glow, haze, reflection, and time-of-day feel.
Apply dimension weights only to the matching visual dimensions. A high character weight should not automatically override lighting. A high lighting weight should not force the literal subject into the prompt.

Direction semantics for dimension weights (steer toward vs away):
- 1.0 is neutral: treat that reference's contribution to that dimension as normal evidence.
- Above 1.0 steers toward that reference's take on that dimension. The reference with the highest effective value (overall weight x dimension weight) leads that dimension for the whole board and should visibly shape it.
- Below 1.0 steers away: reduce that reference's influence on that dimension. Below 0.5 means actively avoid that reference's take on that dimension — prefer other references for it, and if no reference steers toward that dimension, keep it understated, neutral, and unremarkable rather than inventing emphasis.
- The payload provides dimension_guidance (per-dimension leader, steer_toward list, steer_away list) and a directives list on each reference. Treat these as binding art direction, not suggestions. Resolve conflicts in favor of the higher effective influence, and in favor of explicit user intent when stated.
- Leadership is material, not atmospheric. The character leader's subject content must appear at subject level in the final prompt — named in the subject description itself, not relegated to environment hints, palette echoes, or mood words. If the character leader is a non-human object, creature, logo, or motif while other references contain people, fuse it INTO the subject: a central prop, a worn or held object, a dominant emblem — the user raised that dial to put it in the frame. The same applies per dimension: the style leader's style is THE style, the lighting leader's light is THE light.

User overrides per reference (positive / negative):
- Each reference may include a positive field (user-supplied content, tags, or focuses to include) and a negative field (user-supplied content to avoid or exclude). These are explicit user intent and outrank the image analysis.
- Treat positive entries as high-priority inclusions tied to that reference's subject; weave them into the main prompt naturally rather than appending a raw tag dump, and do not drop them.
- Treat negative entries as hard avoidances: fold them into the negative prompt / --no list / exclusions for the selected format, and never contradict them in the main prompt.
- A reference's positive/negative still respects its weights: apply them most strongly to the dimensions that reference is steering toward.

Named subject preservation:
- The payload may include subject_entities and a character_anchor. These are not decoration; they are user intent hints derived from image analysis.
- If the highest character influence reference contains a named person, fictional character, brand mascot, or other proper-noun subject, preserve that exact subject name in the final prompt unless the user explicitly lowers its character weight or another higher-character reference conflicts.
- Do not generalize a named subject into "a man", "a celebrity", "an athlete", "a model", or "a figure" when character weight is high.
- Low-character references may contribute style, lighting, and composition, but they must not replace or erase the named character anchor.
- If multiple references repeat the same named subject, treat that subject as locked and make the rest of the board orbit around it.

Typography preservation:
- If any analysis contains quoted text transcriptions (words the model read from the image), those exact strings MUST appear verbatim in the final prompt — preserve the original spelling, capitalization, and punctuation inside quotation marks.
- Do not paraphrase, summarize, or genericize transcribed text. The exact quoted words from the analysis must appear unchanged — never replace them with vague stand-ins like "bold stylized typography" or "text elements".
- Include the typeface style, placement, and visual treatment described in the analysis alongside the verbatim text.
- If multiple references contain different text, include all of them with their described visual treatments.

Scene integrity:
- The final prompt must contain every primary subject the analyses describe. If an analysis describes a person, that person appears in the final prompt — never reduce a scene to a product shot, logo study, or environment piece because a brand, text element, or object is also prominent.
- Props and held objects (weapons, drinks, devices, branded products) stay attached to the subject holding them, with the same framing relationship the analyses describe.
- Never invent avoidances. Negative direction may only contain failure modes consistent with the analyses and user-provided negatives. If the board contains a person, "avoid human elements" is a contradiction, not a valid negative.

Board coverage — weight decides how much, never whether:
- Every reference must leave at least one visible fingerprint in the final prompt: a subject trait, style cue, palette note, material or texture, typographic treatment, compositional idea, or mood accent. A reference with low weight contributes less, but never nothing.
- When a reference's literal subject cannot coexist with the scene the anchors define, do not drop it — translate it. Carry its abstract qualities (palette, finish, texture, humor, typographic voice, graphic language) into the direction instead.
- Typography and logos are content, not decoration: if any analysis transcribes text or identifies a logo, mark, or brand treatment, it must surface in the final prompt unless a user negative excludes it. Never claim no typography exists when an analysis contains some.
- Before returning, run a coverage pass: for each reference, confirm at least one concrete element in the output traces back to it. If any reference contributed nothing, revise the output before returning.

Cultural and style reference preservation:
- If an analysis identifies a specific franchise, studio, artist, movement, or brand reference, preserve that exact attribution in the final prompt. Do not dilute a named reference into a generic label like "3D animation" or "animated style".
- Only carry references that appear in the analyses — never introduce a franchise, studio, or artist the analyses do not mention.
- Named cultural references are compositional anchors — they communicate more visual information in fewer words than generic descriptions.

Board notes:
- The payload may include board_notes: short written directions the user pinned to the board (mood words, subject requests, constraints, references).
- Each note is explicit user intent for the whole board. Notes outrank image analyses and dimension weights; only a reference's own positive/negative fields sit at the same level.
- Weave note content into the final prompt naturally as art direction — never quote a note as commentary. Notes phrased as exclusions belong in the negative prompt.

Always fuse the board into one coherent result. Never list images separately. Never say moodboard, reference image, image 1, image 2, based on the board, or inspired by these images. Avoid generic hype language such as beautiful, stunning, masterpiece, ultra detailed, award winning, and trending. Use concrete visual language: subject, composition, viewpoint, light, palette, texture, atmosphere, medium, finish, and avoidances.

Return exactly the selected output format specified below — never any other format.`;

/* One spec per output format. Only the SELECTED format's spec is sent with a
 * request (see buildImageSynthSystem) — sending all specs at once caused
 * models to blend formats, e.g. returning the JSON structure with Deep
 * Director section names inside it.                                        */
const IMAGE_SYNTH_FORMAT_SPECS = {
  json: `Return valid JSON only with keys in this order: schema, format, visual_thesis, prompt, visual_dna, reference_fusion, negative_prompt, generation_hints, quality_checks. Use schema "mood.image_prompt.v1" and format "json". Include prompt.primary, prompt.short, and prompt.expanded. In reference_fusion include anchor_details, supporting_details, outlier_handling, conflicts_resolved, and weighting_decisions.`,

  verbose_flux_caption: `Return plain text only with these exact sections: PROMPT, NEGATIVE PROMPT, STYLE KEYWORDS, PARAMETER NOTES. PROMPT must be one dense caption of 120-260 words. NEGATIVE PROMPT must be one comma-separated line of useful avoidances. STYLE KEYWORDS must be 12-32 comma-separated keywords. PARAMETER NOTES must be 2-5 short notes.`,

  ideogram_json: `Return valid JSON only with keys in this order: high_level_description, style_description, compositional_deconstruction. For photo outputs, style_description key order is aesthetics, lighting, photo, medium, color_palette. For non-photo outputs, style_description key order is aesthetics, lighting, medium, art_style, color_palette. compositional_deconstruction key order is background, elements. Elements use type "obj" or "text". Use bbox arrays as [y_min, x_min, y_max, x_max] on a 0-1000 canvas when placement matters. Hex colors must be uppercase #RRGGBB.`,

  midjourney_tags: `Return one Midjourney-style line only: /imagine prompt: subject-and-scene sentence, comma-separated style tags, composition tags, lighting tags, palette tags, texture tags, atmosphere tags, medium tags --ar aspect_ratio --stylize stylize_value --quality quality_value --chaos chaos_value --no negative_terms. Do not use artist names. Do not add a version flag unless the payload provides one.`,

  deep_director: `Return plain text only using these exact labeled sections. Do not return JSON. Write in direct, controlled language — short sections, concrete visual details. Every section should define what must appear, how it should feel, what details matter, and what to avoid.

STYLE NAME: A short, evocative name for the visual direction.

STYLE DEFINITION: 1-2 sentences defining the visual law of the image — the governing principle that makes every other decision coherent.

SUBJECT: Species/type, pose, expression, costume, accessories, distinguishing features. If the subject is a known or recognizable character/parody/homage, name it explicitly. Make the subject specific, not generic.

FACE / IDENTITY DESIGN: Facial features, expression specifics, skin texture, age markers, gaze direction, identity-defining details. Skip if no face is present.

BODY / POSE: Posture, gesture, body language, physical proportions, weight distribution, movement or stillness.

WARDROBE / OBJECTS: Clothing materials, condition, fit, color. Props, accessories — their texture, wear, placement, and relationship to the subject.

TYPOGRAPHY: If any analysis transcribes text or identifies a logo, brand mark, signature, or emblem, it belongs here — exact strings in quotes, marks described with their material and treatment (e.g. a swoosh formed from horseshoe metal). Write "None" only when no analysis contains any text, logo, or mark. If genuinely none, omit this section entirely.

PHOTOGRAPHY / RENDERING: Camera type (real or virtual), lens behavior, focal length feel, depth of field, film stock or render engine quality, grain or noise, sharpness, aberration. Define the boundary: real vs artificial, documentary vs cinematic, photograph vs render.

ENVIRONMENT: Setting, spatial depth, ground plane, background elements, atmospheric particles, weather or underwater conditions, world-building details. Specific materials and surfaces.

LIGHTING: Source direction, quality (hard/soft), color temperature, contrast ratio, shadow behavior, volumetric effects (rays, caustics, haze, glow). Time of day or artificial source.

COMPOSITION: Camera angle, distance, subject placement in frame, negative space, leading lines, depth layers, perspective type.

COLOR & PALETTE: Dominant hues, accent colors, saturation level, temperature, palette mood. Use specific color names, not vague terms.

MOOD: Emotional temperature, energy level, narrative tension, the feeling the image should produce in the viewer. Use contradictions when useful (ordinary but wrong, beautiful but uncomfortable, public but intimate).

NEGATIVE DIRECTION: Explicit failure modes to avoid — wrong genre, wrong lighting, wrong mood, wrong anatomy, wrong surface, wrong setting, over-polish, cartoon exaggeration, fantasy drift, fashion editorial drift, horror drift, CGI uncanny valley. Be specific to this image and grounded in the board's actual content — never exclude something the analyses say is present.

FINAL FORMULA: One single compact sentence that compresses the entire direction into a clean, production-ready prompt.`,
};

// Assemble the synthesis system prompt for one request: shared rules + ONLY
// the selected format's spec. The "Selected output format:" marker is also
// what extractLmStudioFinalContent reads to pick its recovery strategy.
function buildImageSynthSystem(selectedFormat) {
  const spec =
    IMAGE_SYNTH_FORMAT_SPECS[selectedFormat] ||
    IMAGE_SYNTH_FORMAT_SPECS[DEFAULT_PROMPT_FORMAT];
  return `${IMAGE_SYNTH_SYSTEM}

Selected output format: ${selectedFormat}

${spec}

Avoid these words and phrases everywhere: cinematic masterpiece, hyper realistic, stunning, ultra detailed, award winning, beautiful, breathtaking, iconic, magical, captivating, immersive, trending on artstation.

Before returning, check that the output has no placeholders, no unresolved notes, no hidden analysis commentary, and matches the selected output format exactly.`;
}

/* Remix kit — decomposes the board's fused direction into isolated,
 * subject-agnostic "lenses" the user can apply to entirely new subjects.
 * This is the board-as-vocabulary output, distinct from the board-as-scene
 * output the synthesis prompt produces.                                    */
const REMIX_SYSTEM = `You are the Mood Director remix agent. A user has a mood board of analyzed reference images. Your job is NOT to describe one image or scene — it is to decompose the board's collective visual DNA into isolated, reusable prompt layers ("lenses") the user can apply to entirely new subjects of their own.

Rules:
- Each lens must stand alone as model-ready prompt language — concrete, visual, specific. No meta commentary, no references to "the board", "the images", or "the references".
- Lenses are subject-agnostic: the board's literal subjects may appear only in SUBJECT ESSENCE. Everywhere else, where the user's own content belongs, write the placeholder [SUBJECT], [SETTING], or [TEXT].
- Weights scale vocabulary share: higher-weight references shape every lens more strongly, but every reference contributes at least one distinctive trait somewhere in the kit.
- Fuse across images into one shared language. Where references genuinely diverge, offer the tension as alternatives ("polished chrome or mud-caked iron") rather than dropping one side.
- If any analysis transcribes text or identifies a logo or brand treatment, capture its typographic voice in TYPOGRAPHY LENS (exact strings in quotes plus treatment).
- If board_notes are present they are the user's written direction: bias every lens toward them.
- Avoid hype words: beautiful, stunning, masterpiece, ultra detailed, award winning, breathtaking, cinematic masterpiece.

Return plain text with exactly these labeled sections, each 1-4 sentences of dense prompt language:

SUBJECT ESSENCE: The board's subject archetypes and their defining traits, written as transferable character/subject vocabulary.

STYLE LENS: Medium, render or photographic finish, era, graphic language — phrased so it can restyle any [SUBJECT].

PALETTE LENS: Named colors, temperature, saturation, contrast behavior, where accents land.

LIGHTING LENS: Source direction, quality, color temperature, shadow behavior, signature effects (glints, glow, haze, caustics).

COMPOSITION LENS: Framing, camera feel, subject placement, negative space, depth — written around [SUBJECT].

TEXTURE & MATERIAL LENS: Surfaces, materials, wear and condition, tactile contrasts.

MOOD LENS: Emotional temperature, energy, narrative tension — the atmosphere vocabulary of the board.

TYPOGRAPHY LENS: Exact transcribed text or logo treatments in quotes with their visual voice, or the single line "No typography on this board."

AVOID: What would break this aesthetic — concrete failure modes drawn from the board's character, comma-separated.

TEMPLATE: One fill-in-the-blank master prompt that assembles the lenses around [SUBJECT] (and [SETTING] / [TEXT] where useful), ready to paste into an image model.

Before returning, check every section label is present, spelled exactly as above, and that no section leaks the board's literal subject outside SUBJECT ESSENCE.`;

const REMIX_LENSES = [
  { key: "all", label: "All layers" },
  { key: "SUBJECT ESSENCE", label: "Subject essence" },
  { key: "STYLE LENS", label: "Style" },
  { key: "PALETTE LENS", label: "Palette" },
  { key: "LIGHTING LENS", label: "Lighting" },
  { key: "COMPOSITION LENS", label: "Composition" },
  { key: "TEXTURE & MATERIAL LENS", label: "Texture & material" },
  { key: "MOOD LENS", label: "Mood" },
  { key: "TYPOGRAPHY LENS", label: "Typography" },
  { key: "AVOID", label: "Avoid" },
  { key: "TEMPLATE", label: "Template" },
];

// Pull one labeled lens section out of the remix-kit text. Line scanner
// rather than regex so markdown-decorated labels (e.g. "**STYLE LENS:**")
// from smaller models still parse.
function extractRemixLens(kit, key) {
  if (!kit) return "";
  if (key === "all") return kit.trim();
  const labels = REMIX_LENSES.filter((l) => l.key !== "all").map((l) => l.key);
  const normalize = (line) => line.replace(/^[\s*#>-]+/, "");
  const labelOf = (line) => {
    const n = normalize(line).toUpperCase();
    return labels.find((l) => n.startsWith(l + ":")) || null;
  };
  const out = [];
  let collecting = false;
  for (const line of kit.split("\n")) {
    const label = labelOf(line);
    if (label === key) {
      collecting = true;
      out.push(
        normalize(line)
          .slice(label.length + 1)
          .replace(/^[\s*]+/, "")
          .replace(/\*+$/, "")
          .trim()
      );
      continue;
    }
    if (label) {
      if (collecting) break;
      continue;
    }
    if (collecting) out.push(line);
  }
  return out.join("\n").trim();
}

async function generateRemixKit(cfg, references, notes = []) {
  const normalized = references
    .map((ref, i) => ({
      index: i + 1,
      source_id: ref.id || `reference-${i + 1}`,
      weight: clampImageWeight(ref.weight),
      dimension_weights: normalizeDimensionWeights(ref.dimensionWeights),
      positive: (ref.positive || "").trim(),
      negative: (ref.negative || "").trim(),
      analysis: ref.analysis || "",
    }))
    .filter((r) => r.analysis.trim());
  const boardNotes = (notes || [])
    .map((n) => (typeof n === "string" ? n : n?.content || ""))
    .map((s) => s.trim())
    .filter(Boolean);
  return runCompletion(cfg, {
    system: REMIX_SYSTEM,
    text:
      `Decompose this board of ${normalized.length} weighted reference(s) into the remix kit sections.\n\n` +
      JSON.stringify(
        {
          references: normalized,
          board_notes: boardNotes.length ? boardNotes : undefined,
        },
        null,
        2
      ),
    maxTokens: 2000,
  });
}

const SKILL_SYSTEM = `You reverse-engineer a writer's style into a reusable skill.md file. You are given multiple writing samples from a single voice. Produce ONE cohesive style guide in GitHub-flavored Markdown that another writer or AI could follow to reliably reproduce this voice. Synthesize ACROSS all samples — do not summarize each sample separately.

Use exactly these sections:
# Writing Style: <a short descriptive name you infer>
## Overview
## Voice & Tone
## Sentence Structure & Rhythm
## Vocabulary & Diction
## Punctuation & Formatting Habits
## Recurring Themes & Subjects
## Structural Habits
## Do / Don't
## Voice Cheat-Sheet

Be specific and reference concrete observed patterns. In the cheat-sheet, give a few short PARAPHRASED example phrasings that feel characteristic — do NOT copy long verbatim passages from the samples. Output only the Markdown.`;

async function analyzeImage(cfg, dataUrl) {
  if (!splitDataUrl(dataUrl)) throw new Error("Bad image data");
  return runCompletion(cfg, {
    system: IMAGE_ANALYSIS_SYSTEM,
    text: "Analyze this reference image for a mood board.",
    images: [dataUrl],
    // No sentence cap in the prompt — give dense images (posters, layouts)
    // room to be fully transcribed and described.
    maxTokens: 2000,
  });
}

// The image items on a board that are ready to feed synthesis.
function readyImageRefs(board) {
  return (board?.items || []).filter(
    (it) =>
      it.kind === "image" &&
      it.analysisStatus === "ready" &&
      it.analysis &&
      !it.disabled
  );
}

// Content signature for a board's synthesis inputs (weights, focus fields,
// analyses) — used to detect when derived outputs are stale.
function imageContentSig(refs) {
  return refs
    .map(
      (r) =>
        `${r.id}:${formatImageWeight(r.weight)}:${formatDimensionWeights(
          r.dimensionWeights
        )}:p${r.positive || ""}:n${r.negative || ""}:a${r.analysis || ""}`
    )
    .join("|");
}

// Notes pinned to an image board that are toggled into the prompt.
function enabledBoardNotes(board) {
  return (board?.items || []).filter(
    (it) => it.kind === "text" && !it.disabled && (it.content || "").trim()
  );
}

// Full synthesis-input signature for a board: images + included notes.
function boardContentSig(board) {
  return (
    imageContentSig(readyImageRefs(board)) +
    "|N|" +
    enabledBoardNotes(board)
      .map((n) => `${n.id}:${n.content}`)
      .join("|")
  );
}

async function synthesizeImagePrompt(
  cfg,
  references,
  selectedFormat = DEFAULT_PROMPT_FORMAT,
  aspectRatio = DEFAULT_ASPECT_RATIO,
  notes = []
) {
  const boardNotes = (notes || [])
    .map((n) => (typeof n === "string" ? n : n?.content || ""))
    .map((s) => s.trim())
    .filter(Boolean);
  const normalized = references
    .map((ref, i) => {
      const obj = typeof ref === "string" ? { analysis: ref } : ref || {};
      const dimensionWeights = normalizeDimensionWeights(
        obj.dimensionWeights || obj.dimension_weights
      );
      const analysis = obj.analysis || "";
      return {
        index: i + 1,
        source_id: obj.id || obj.source_id || `reference-${i + 1}`,
        weight: clampImageWeight(obj.weight ?? obj.user_weight),
        dimension_weights: dimensionWeights,
        character_influence: clampImageWeight(obj.weight ?? obj.user_weight) * dimensionWeights.character,
        subject_entities: extractSubjectEntities(analysis),
        positive: (obj.positive || "").trim(),
        negative: (obj.negative || "").trim(),
        analysis,
      };
    })
    .filter((ref) => ref.analysis.trim());

  const characterAnchor = normalized
    .slice()
    .sort((a, b) => getCharacterInfluence(b) - getCharacterInfluence(a))[0];

  // Per-dimension steering map derived deterministically from the dials.
  const dimensionGuidance = IMAGE_DIMENSION_WEIGHTS.map((dim) => {
    const ranked = normalized
      .map((r) => ({
        source_id: r.source_id,
        dimension_weight: r.dimension_weights[dim.key],
        effective_influence: r.weight * r.dimension_weights[dim.key],
      }))
      .sort((a, b) => b.effective_influence - a.effective_influence);
    return {
      dimension: dim.key,
      leader:
        ranked[0] && ranked[0].effective_influence > 1.0 ? ranked[0].source_id : null,
      steer_toward: ranked
        .filter((r) => r.dimension_weight >= 1.1)
        .map((r) => r.source_id),
      steer_away: ranked
        .filter((r) => r.dimension_weight < 0.9)
        .map((r) => r.source_id),
    };
  });

  // Attach a plain-language directive list to each reference so weaker /
  // local models still receive the steering even if they ignore the numbers.
  const referencesWithDirectives = normalized.map((r) => ({
    ...r,
    directives: IMAGE_DIMENSION_WEIGHTS.map((dim) => {
      const band = weightBand(r.dimension_weights[dim.key]);
      if (band.dir === "neutral") return null;
      return `${dim.key}: ${band.verb} this reference's ${dim.key}`;
    }).filter(Boolean),
  }));

  const payload = {
    schema: "mood.weighted_image_board.v1",
    selected_format: selectedFormat,
    aspect_ratio: aspectRatio,
    reference_count: normalized.length,
    weight_scale: {
      default: IMAGE_WEIGHT_DEFAULT,
      min: IMAGE_WEIGHT_MIN,
      max: IMAGE_WEIGHT_MAX,
      meaning:
        "weights are relative synthesis influence controls; 1.0 is normal, higher values lead more, lower values support",
    },
    character_anchor: characterAnchor
      ? {
          source_id: characterAnchor.source_id,
          character_influence: characterAnchor.character_influence,
          subject_entities: characterAnchor.subject_entities,
          instruction:
            "When subject_entities are present and this anchor has the highest character influence, preserve the exact named subject in the final prompt.",
        }
      : null,
    dimension_guidance: dimensionGuidance,
    board_notes: boardNotes.length ? boardNotes : undefined,
    references: referencesWithDirectives,
  };

  const userText =
    `Here are weighted analyses of ${normalized.length} reference image(s) collected on a single image board. ` +
    `Use selected_format=${selectedFormat}, aspect_ratio=${aspectRatio}, and the weight rules to synthesize one final prompt. ` +
    `Honor dimension_guidance and each reference's directives: steer the result toward dimensions weighted above 1.0 and away from dimensions weighted below 1.0. ` +
    `Apply each reference's positive field as must-include content and its negative field as must-avoid content. ` +
    (boardNotes.length
      ? `board_notes carry the user's written direction for the whole board — treat them as binding intent above the analyses. `
      : "") +
    (characterAnchor?.subject_entities?.length
      ? `The current character anchor names this subject: ${characterAnchor.subject_entities.join(
          ", "
        )}. Preserve the exact named subject if character influence is high.\n\n`
      : "\n\n") +
    JSON.stringify(payload, null, 2);
  const maxTokens =
    selectedFormat === "deep_director"
      ? 2400
      : selectedFormat === "json" || selectedFormat === "ideogram_json"
        ? 1800
        : 1200;

  let out = await runCompletion(cfg, {
    system: buildImageSynthSystem(selectedFormat),
    text: userText,
    maxTokens,
  });
  // Format guard: if the model returned the wrong shape (e.g. JSON for a
  // plain-text format), retry once with an explicit correction.
  if (!outputMatchesFormat(out, selectedFormat)) {
    out = await runCompletion(cfg, {
      system: buildImageSynthSystem(selectedFormat),
      text:
        `Your previous attempt used the wrong output format. Return strictly the ${selectedFormat} format as specified in the system prompt — no other structure.\n\n` +
        userText,
      maxTokens,
    });
  }
  return out;
}

// Cheap structural check that a synthesis result matches its format.
function outputMatchesFormat(text, fmt) {
  const t = (text || "").trim();
  if (!t) return false;
  if (fmt === "json" || fmt === "ideogram_json") return t.startsWith("{");
  if (fmt === "deep_director")
    return !t.startsWith("{") && /STYLE NAME\s*:/i.test(t);
  if (fmt === "midjourney_tags") return /\/imagine prompt:/i.test(t);
  if (fmt === "verbose_flux_caption")
    return !t.startsWith("{") && /PROMPT\s*:/i.test(t);
  return true;
}

async function generateSkillMd(cfg, notes) {
  const joined = notes
    .map((n, i) => `--- Sample ${i + 1} ---\n${n}`)
    .join("\n\n");
  return runCompletion(cfg, {
    system: SKILL_SYSTEM,
    text: `Here are ${notes.length} writing samples from one author/voice:\n\n${joined}\n\nProduce the skill.md as instructed.`,
    maxTokens: 2000,
  });
}

/* --------------------------- helpers --------------------------- */

const uid = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function splitDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsText(file);
  });
}

function downscaleDataUrl(dataUrl, maxDim = 1024, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(c.toDataURL("image/jpeg", quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function getHeroImagesForBoard(board) {
  const images = (board?.items || [])
    .filter((item) => item.kind === "image" && item.src)
    .slice()
    .sort((a, b) => {
      const weightDiff = clampImageWeight(b.weight) - clampImageWeight(a.weight);
      if (weightDiff !== 0) return weightDiff;
      return (b.z || 0) - (a.z || 0);
    })
    .map((item) => ({
      id: item.id,
      src: item.src,
      weight: clampImageWeight(item.weight),
    }));

  if (!images.length) return [];
  return Array.from({ length: 3 }, (_, i) => images[i % images.length]);
}

function createPromptLibraryCard(board, provider) {
  return {
    id: uid(),
    title: board.name || "Untitled prompt",
    sourceBoardId: board.id,
    boardName: board.name || "Untitled board",
    promptFormat: board.promptFormat || DEFAULT_PROMPT_FORMAT,
    prompt: board.output || "",
    heroImages: getHeroImagesForBoard(board),
    provider,
    createdAt: new Date().toISOString(),
  };
}

function formatShortDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "saved";
  }
}

/* ----------------------- prompt history ------------------------ */

const MAX_HISTORY = 30;

// Human-readable "what changed" between two synthesis input snapshots.
function summarizeInputChange(prev, curr, prevFormat, currFormat) {
  if (!prev) return "First prompt";
  const parts = [];
  const prevById = new Map(prev.map((r) => [r.id, r]));
  const currById = new Map(curr.map((r) => [r.id, r]));
  const added = curr.filter((r) => !prevById.has(r.id)).length;
  const removed = prev.filter((r) => !currById.has(r.id)).length;
  if (added) parts.push(`+${added} image${added > 1 ? "s" : ""}`);
  if (removed) parts.push(`−${removed} image${removed > 1 ? "s" : ""}`);
  let weights = 0;
  let dims = 0;
  let focus = 0;
  let analyses = 0;
  let noteEdits = 0;
  for (const r of curr) {
    const p = prevById.get(r.id);
    if (!p) continue;
    if ((r.note || "") !== (p.note || "")) noteEdits++;
    if (formatImageWeight(r.weight) !== formatImageWeight(p.weight)) weights++;
    if (
      formatDimensionWeights(r.dimensionWeights) !==
      formatDimensionWeights(p.dimensionWeights)
    )
      dims++;
    if ((r.positive || "") !== (p.positive || "") || (r.negative || "") !== (p.negative || ""))
      focus++;
    if ((r.analysis || "") !== (p.analysis || "")) analyses++;
  }
  if (weights) parts.push(`${weights} weight${weights > 1 ? "s" : ""} changed`);
  if (dims) parts.push(`${dims} dimension edit${dims > 1 ? "s" : ""}`);
  if (focus) parts.push(`${focus} focus edit${focus > 1 ? "s" : ""}`);
  if (analyses) parts.push(`${analyses} analysis edit${analyses > 1 ? "s" : ""}`);
  if (noteEdits) parts.push(`${noteEdits} note edit${noteEdits > 1 ? "s" : ""}`);
  if (prevFormat !== currFormat)
    parts.push(`format → ${PROMPT_FORMATS[currFormat] || currFormat}`);
  return parts.length ? parts.join(" · ") : "Regenerated (no board change)";
}

function tokenizeForDiff(s) {
  return String(s || "")
    .split(/(\s+)/)
    .filter((t) => t.length);
}

// Word-level diff (LCS). Returns tokens tagged same / add / del.
function diffTokens(aStr, bStr) {
  const a = tokenizeForDiff(aStr);
  const b = tokenizeForDiff(bStr);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}

/* ------------------------- canvas items ------------------------ */

function ImageItem({
  item,
  onStartDrag,
  onDelete,
  onWeightChange,
  onDimensionWeightChange,
  onFieldChange,
  onToggleDisabled,
  onReanalyze,
}) {
  const weight = clampImageWeight(item.weight);
  const dimensionWeights = normalizeDimensionWeights(item.dimensionWeights);
  const [weightOpen, setWeightOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const disabled = Boolean(item.disabled);
  const hasOverrides = Boolean(
    (item.positive || "").trim() || (item.negative || "").trim()
  );

  return (
    <div
      onMouseDown={(e) => onStartDrag(e, item)}
      style={{ left: item.x, top: item.y, zIndex: item.z || 1, width: 220 }}
      className={`absolute cursor-grab select-none rounded-md border bg-white shadow-sm active:cursor-grabbing ${
        disabled ? "border-dashed border-slate-300 opacity-60" : "border-slate-300"
      }`}
    >
      {disabled && !flipped && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-slate-900/85 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
          Hidden from prompt
        </div>
      )}
      {flipped ? (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="mood-flip-in space-y-2 rounded-t-md bg-slate-50 p-2"
        >
          <div>
            <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-800 text-white">
                <Plus size={9} />
              </span>
              Emphasize
            </span>
            <textarea
              value={item.positive || ""}
              onChange={(e) => onFieldChange(item.id, { positive: e.target.value })}
              placeholder="content, tags, or focuses to include…"
              className="block h-16 w-full resize-none rounded border border-slate-200 bg-white p-1.5 text-[11px] leading-snug text-slate-800 outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-600 text-white">
                <Minus size={9} />
              </span>
              Avoid
            </span>
            <textarea
              value={item.negative || ""}
              onChange={(e) => onFieldChange(item.id, { negative: e.target.value })}
              placeholder="content to exclude…"
              className="block h-16 w-full resize-none rounded border border-slate-200 bg-white p-1.5 text-[11px] leading-snug text-slate-800 outline-none focus:border-rose-400"
            />
          </div>
          {item.analysis != null && (
            <div>
              <span className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                What the model saw
                <button
                  onClick={() => onReanalyze(item.id)}
                  disabled={item.analysisStatus === "loading"}
                  className="flex items-center gap-1 rounded px-1 py-0.5 normal-case tracking-normal text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                  title="Re-run analysis on this image (replaces your edits)"
                >
                  <RefreshCw
                    size={10}
                    className={item.analysisStatus === "loading" ? "animate-spin" : ""}
                  />
                  re-analyze
                </button>
              </span>
              <textarea
                value={item.analysis || ""}
                onChange={(e) => onFieldChange(item.id, { analysis: e.target.value })}
                placeholder="edit what the model saw — add anything it missed…"
                className="block h-24 w-full resize-none rounded border border-slate-200 bg-white p-1.5 text-[10px] leading-snug text-slate-600 outline-none focus:border-slate-400"
              />
            </div>
          )}
        </div>
      ) : (
        <img
          src={item.src}
          alt=""
          draggable={false}
          className="block w-full rounded-t-md pointer-events-none"
        />
      )}
      <div className="flex items-center justify-between gap-2 px-2 py-1 text-[11px]">
        {item.analysisStatus === "loading" && (
          <span className="flex items-center gap-1 text-amber-600">
            <Loader2 size={12} className="animate-spin" /> analyzing…
          </span>
        )}
        {item.analysisStatus === "ready" && (
          <span className="flex items-center gap-1 text-emerald-600">
            <Check size={12} /> analyzed
          </span>
        )}
        {item.analysisStatus === "error" && (
          <span className="flex items-center gap-1 text-rose-600">
            analysis failed
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onReanalyze(item.id)}
              className="rounded p-0.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
              title="Retry analysis"
            >
              <RefreshCw size={11} />
            </button>
          </span>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onToggleDisabled(item.id)}
            className={`flex items-center rounded p-0.5 transition-colors ${
              disabled
                ? "text-slate-700 hover:bg-slate-100"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            }`}
            title={disabled ? "Include in prompt" : "Hide from prompt"}
          >
            {disabled ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setFlipped((f) => !f)}
            className={`flex items-center rounded px-1 py-0.5 leading-none transition-colors ${
              flipped || hasOverrides
                ? "text-slate-700 hover:bg-slate-100"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            }`}
            title={
              flipped
                ? "Back to image"
                : "Add positive / negative prompts for this image"
            }
          >
            {flipped ? (
              <ImageIcon size={13} />
            ) : (
              <span className="flex items-center">
                <Plus size={11} />
                <Minus size={11} className="-ml-0.5" />
              </span>
            )}
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onDelete(item.id)}
            className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            title="Remove"
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="border-t border-slate-100 text-[11px] text-slate-500"
      >
        <button
          type="button"
          onClick={() => setWeightOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-slate-50"
          title="Fine-tune reference influence"
        >
          <span className="flex items-center gap-1 font-medium text-slate-600">
            <SlidersHorizontal size={12} /> weight
          </span>
          <span className="font-mono text-slate-700">{formatImageWeight(weight)}x</span>
        </button>
        <div className="flex items-center gap-2 px-2 pb-1.5">
          <input
            type="range"
            min={IMAGE_WEIGHT_MIN}
            max={IMAGE_WEIGHT_MAX}
            step={IMAGE_WEIGHT_STEP}
            value={weight}
            onChange={(e) => onWeightChange(item.id, e.target.value)}
            className="min-w-0 flex-1 accent-indigo-600"
            title="Reference influence weight"
          />
          <input
            type="number"
            min={IMAGE_WEIGHT_MIN}
            max={IMAGE_WEIGHT_MAX}
            step={IMAGE_WEIGHT_STEP}
            value={formatImageWeight(weight)}
            onChange={(e) => onWeightChange(item.id, e.target.value)}
            className="w-14 rounded border border-slate-200 px-1 py-0.5 text-right font-mono text-[11px] outline-none focus:border-indigo-400"
            title="Reference influence weight"
          />
        </div>
        <div
          className={`overflow-hidden border-t border-slate-100 bg-slate-50 transition-[max-height,opacity] duration-200 ease-out ${
            weightOpen ? "max-h-64 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="space-y-2 px-2 py-2">
            {IMAGE_DIMENSION_WEIGHTS.map((dim) => {
              const dimWeight = dimensionWeights[dim.key];
              return (
                <label key={dim.key} className="block">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-600">{dim.label}</span>
                    <span className="font-mono text-slate-700">
                      {formatImageWeight(dimWeight)}x
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={IMAGE_WEIGHT_MIN}
                      max={IMAGE_WEIGHT_MAX}
                      step={IMAGE_WEIGHT_STEP}
                      value={dimWeight}
                      onChange={(e) =>
                        onDimensionWeightChange(item.id, dim.key, e.target.value)
                      }
                      className="min-w-0 flex-1 accent-indigo-600"
                      title={`${dim.label} influence weight`}
                    />
                    <input
                      type="number"
                      min={IMAGE_WEIGHT_MIN}
                      max={IMAGE_WEIGHT_MAX}
                      step={IMAGE_WEIGHT_STEP}
                      value={formatImageWeight(dimWeight)}
                      onChange={(e) =>
                        onDimensionWeightChange(item.id, dim.key, e.target.value)
                      }
                      className="w-14 rounded border border-slate-200 bg-white px-1 py-0.5 text-right font-mono text-[11px] outline-none focus:border-indigo-400"
                      title={`${dim.label} influence weight`}
                    />
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function NoteItem({ item, onStartDrag, onDelete, onChange, onToggleDisabled }) {
  return (
    <div
      style={{ left: item.x, top: item.y, zIndex: item.z || 1, width: 220 }}
      className={`absolute select-none rounded-md border border-amber-300 bg-amber-50 shadow-sm ${
        item.disabled ? "opacity-60" : ""
      }`}
    >
      <div
        onMouseDown={(e) => onStartDrag(e, item)}
        className="flex cursor-grab items-center gap-1 rounded-t-md bg-amber-100 px-2 py-1 text-[11px] text-amber-800 active:cursor-grabbing"
      >
        <StickyNote size={12} /> {item.disabled ? "note" : "note · in prompt"}
        {onToggleDisabled && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onToggleDisabled(item.id)}
            className="ml-auto rounded p-0.5 text-amber-500 hover:bg-amber-200 hover:text-amber-800"
            title={
              item.disabled
                ? "Include this note in the prompt"
                : "Hide this note from the prompt"
            }
          >
            {item.disabled ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onDelete(item.id)}
          className={`${onToggleDisabled ? "" : "ml-auto "}rounded p-0.5 text-amber-500 hover:bg-rose-50 hover:text-rose-600`}
          title="Remove"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <textarea
        value={item.content}
        placeholder="Write direction for this board — mood, subject, constraints…"
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange(item.id, e.target.value)}
        className="block h-28 w-full resize-none rounded-b-md bg-amber-50 p-2 text-[12px] leading-snug text-slate-800 outline-none"
      />
    </div>
  );
}

/* ---------------------- guided first board --------------------- *
 * The demo board ships fully precomputed — analyses, fused prompt, and a
 * two-entry history that shows how raising one weight redirects the
 * direction. No model call happens until the user changes something;
 * the seeded content signature makes the auto-synthesis effect treat the
 * canned output as current.                                              */

const DEMO_SAMPLES = [
  {
    img: sampleTypewriterImg,
    name: "sample-typewriter.jpg",
    x: 320,
    weight: 1.0,
    dims: {},
    analysis:
      'A vintage black FAVORIT typewriter photographed directly from above on a pale grey seamless background, the brand name "FAVORIT" stamped across its front panel in worn gold serif capitals. A blank sheet of paper rises from the platen into the empty upper half of the frame. The composition is strictly centered and symmetrical with generous negative space, lit by soft, even, shadowless studio light. Glossy black enamel, round glass-topped keys, and brushed steel details give a tactile machine-age materiality; the palette is a muted monochrome with brass accents. The mood is quiet, archival, and nostalgic — clean product photography with a museum-catalog finish.',
  },
  {
    img: sampleSunsetImg,
    name: "sample-sunset.jpg",
    x: 590,
    weight: 2.3,
    dims: { lighting: 1.4 },
    analysis:
      "A muddy rural track at golden hour, shot from low and close so frozen puddles and tire ruts dominate the foreground while the sun flares hard from the left horizon. Backlit dry grasses and bare scrub catch amber rim light along the ridge; a dirt road curves away toward distant trees under a hazy peach-to-blue sky. The palette runs from burnt orange and honey gold into cool slate blues trapped in the ice. Textures are heavy and tactile — cracked mud, glassy ice, brittle stalks. Strong atmospheric depth with visible sun haze and long soft shadows; the mood is raw, wandering, and end-of-day quiet. Documentary landscape photograph with warm film-like color.",
  },
  {
    img: samplePlantImg,
    name: "sample-plant.jpg",
    x: 860,
    weight: 0.6,
    dims: {},
    analysis:
      "An extreme macro of a flowering shrub before bloom: dozens of pale, closed buds on thin stems fan out between thick glossy leaves beaded with rainwater. Focus is razor-thin — one dewy leaf and the nearest buds are sharp while the background dissolves into deep teal-green shadow. The palette is saturated botanical green shading into near-black blue-greens, with the buds adding soft cream accents. Cool, humid, after-rain atmosphere; intimate and hushed in mood. Naturalistic macro photograph with shallow depth of field and gentle diffused light.",
  },
];

const DEMO_PROMPT_V1 = `PROMPT: A vintage black FAVORIT typewriter with "FAVORIT" in worn gold serif lettering stands centered on weathered ground where cracked mud meets a pale seamless backdrop, a blank page rising from its platen. Even, diffused light keeps the scene calm and catalog-clean while dew-flecked green leaves edge the lower frame, their moisture echoing on the machine's glossy enamel. Muted monochrome and brass tones sit against botanical greens and a distant band of warm horizon light; textures contrast machine-age steel and glass keys with soft organic foliage and damp earth. Centered, symmetrical composition with generous negative space; quiet, nostalgic, faintly wild mood. Documentary-clean photographic finish with fine film grain.

NEGATIVE PROMPT: harsh midday sun, oversaturated neon color, cartoon, illustration, plastic-looking textures, clutter, extra text, watermark, busy background

STYLE KEYWORDS: vintage typewriter, worn gold serif lettering, seamless backdrop, dew-flecked foliage, cracked mud, soft diffused light, muted monochrome, brass accents, botanical green, film grain, centered symmetry, negative space, tactile materials, quiet nostalgia

PARAMETER NOTES:
- Aspect 1:1 keeps the symmetrical, catalog-style framing.
- Keep the lettering legible: render "FAVORIT" exactly, no substitutes.
- Balance studio cleanliness against organic texture roughly 50/50.`;

const DEMO_PROMPT_V2 = `PROMPT: A vintage black FAVORIT typewriter, its front panel lettered "FAVORIT" in worn gold serif capitals, sits abandoned on a muddy rural track at golden hour, a blank page in its platen catching the last light. The low sun flares hard from the left, dragging long shadows across frozen puddles and tire ruts and rimming the machine's glossy enamel, round glass keys, and backlit dry grasses in amber. Burnt orange and honey gold pour across the scene and cool into slate blue where ice traps the sky; dew-beaded leaves in deep teal-green edge the foreground with soft cream buds as quiet accents. Textures are heavy and tactile — cracked mud, glassy ice, brittle stalks, machine-age steel. Low, close camera with strong atmospheric haze and shallow foreground focus; the mood is raw, nostalgic, end-of-day quiet. Warm film-like documentary photograph.

NEGATIVE PROMPT: flat even studio lighting, clinical seamless backdrop, harsh midday sun, oversaturated neon, cartoon, plastic textures, extra text, watermark

STYLE KEYWORDS: golden hour flare, amber rim light, vintage typewriter, worn gold serif lettering, muddy track, frozen puddles, backlit grasses, teal-green foliage accents, dew, long shadows, film-like warmth, atmospheric haze, tactile textures, rural stillness, nostalgic documentary

PARAMETER NOTES:
- Aspect 1:1; keep the typewriter low in frame with the flare entering left.
- Golden-hour light leads every surface — avoid neutral studio fill.
- Render "FAVORIT" exactly as written; the lettering is a focal detail.`;

const DEMO_NOTE = `Welcome! This starter board is precomputed so you can see the whole idea at a glance — nothing has been sent to a model yet.

1. Three sample photos, three roles: the sunset is weighted 2.3× (it leads), the typewriter 1.0×, the plant 0.6× (accents only).
2. Open the prompt history (clock icon, top right) to see how raising the sunset's weight redirected the whole prompt.
3. Flip any card to read — and edit — what the model saw.
4. Notes steer too: add one and open its eye to weave written direction into the prompt. (This note's eye is closed, so it stays out.)

Change anything (a weight, an analysis, your own image) and Mood Director regenerates the prompt for real.`;

/* ---------------------------- app ------------------------------ */

/* ----------------------- scripted tour -------------------------- *
 * Shown on the hosted web build BEFORE the beta password gate: a fully
 * precomputed walkthrough of the analyze → weigh → note → prompt loop.
 * Every interaction is real UI but every result is canned — zero model
 * calls, works logged-out, and doubles as the pitch.                    */

const TOUR_KEY = "mood.tour.v1";

const TOUR_PROMPT_V1 = [
  {
    t: 'A vintage black FAVORIT typewriter with "FAVORIT" in worn gold serif lettering stands centered where cracked mud meets a pale seamless backdrop, a blank page rising from its platen. Even, diffused light keeps the scene catalog-clean while dew-flecked leaves edge the frame; muted monochrome and brass against botanical green. Centered, symmetrical, quiet.',
  },
];

const TOUR_PROMPT_V2 = [
  { t: 'A vintage black FAVORIT typewriter, lettered "FAVORIT" in worn gold serif capitals, sits abandoned ' },
  { t: "on a muddy rural track at golden hour", hl: true },
  { t: ", a blank page catching the last light. " },
  { t: "The low sun flares hard from the left", hl: true },
  { t: ", dragging " },
  { t: "long shadows across frozen puddles", hl: true },
  { t: " and rimming the enamel and backlit grasses " },
  { t: "in amber", hl: true },
  { t: ". Dew-beaded teal-green leaves edge the foreground. " },
  { t: "Raw, nostalgic, end-of-day quiet.", hl: true },
];

const TOUR_NOTE_CHOICES = [
  {
    label: "make it feel like a 1970s album cover",
    segs: [
      { t: "A vintage black FAVORIT typewriter abandoned on a muddy track at golden hour, " },
      { t: "styled as a 1972 gatefold album cover", hl: true },
      { t: ": " },
      { t: "heavy warm film grain", hl: true },
      { t: ", " },
      { t: "faded Kodachrome palette", hl: true },
      { t: ", sun flare dragging long amber shadows, " },
      { t: "hand-set serif title space held open across the sky", hl: true },
      { t: ". Raw, nostalgic, needle-drop quiet." },
    ],
  },
  {
    label: "make it rain — moody, cinematic",
    segs: [
      { t: "A vintage black FAVORIT typewriter abandoned on a muddy track " },
      { t: "in falling rain at blue hour", hl: true },
      { t: ", the last amber light fighting through " },
      { t: "streaked drizzle and rising mist", hl: true },
      { t: ". " },
      { t: "Rain beads on the enamel", hl: true },
      { t: ", puddles catch a cold slate sky, dew-heavy leaves crowd the foreground. " },
      { t: "Somber, cinematic, held-breath quiet.", hl: true },
    ],
  },
];

function TourPrompt({ segs }) {
  return (
    <p className="whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-slate-700">
      {segs.map((s, i) =>
        s.hl ? (
          <mark key={i} className="rounded bg-amber-200/80 px-0.5">
            {s.t}
          </mark>
        ) : (
          <span key={i}>{s.t}</span>
        )
      )}
    </p>
  );
}

function ScriptedTour({ onFinish }) {
  const [stage, setStage] = useState(0); // 0 intro · 1 analyze/flip · 2 weight · 3 note · 4 outro
  const [analyzedCount, setAnalyzedCount] = useState(0);
  const [flipped, setFlipped] = useState(null);
  const [weight, setWeight] = useState(1.0);
  const [weightDone, setWeightDone] = useState(false);
  const [noteChoice, setNoteChoice] = useState(null);

  // Stage 1: cards "analyze" themselves on a staggered clock.
  useEffect(() => {
    if (stage !== 1) return;
    const timers = [600, 1300, 2000].map((ms, i) =>
      setTimeout(() => setAnalyzedCount(i + 1), ms)
    );
    return () => timers.forEach(clearTimeout);
  }, [stage]);

  const samples = DEMO_SAMPLES;
  const promptSegs =
    noteChoice != null
      ? TOUR_NOTE_CHOICES[noteChoice].segs
      : weightDone
        ? TOUR_PROMPT_V2
        : TOUR_PROMPT_V1;
  const showPrompt = stage >= 1 && analyzedCount >= 3;

  const captions = [
    null,
    "Every image you drop is read like an art director would read it — tap a photo to see.",
    "Weights steer the fusion. Drag the sunset's influence up and watch the prompt rewrite itself.",
    "Notes steer too. Pin written direction to the board — pick one:",
    null,
  ];

  return (
    <div className="flex h-screen w-screen flex-col overflow-y-auto bg-[#ece9e2]">
      {/* header */}
      <div className="flex items-center justify-between px-5 py-3">
        <span className="flex items-center gap-2">
          <img src={moodLogo} alt="Mood Director" className="h-6 w-auto" />
          <span className="text-[10px] font-medium uppercase tracking-[0.32em] text-slate-400">
            Director
          </span>
        </span>
        <button
          onClick={onFinish}
          className="text-xs text-slate-400 underline hover:text-slate-600"
        >
          I have the beta password →
        </button>
      </div>

      {stage === 0 && (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="mood-pop-in max-w-md text-center">
            <p className="text-[10px] font-medium uppercase tracking-[0.34em] text-slate-400">
              Private beta
            </p>
            <h1 className="mt-4 font-serif text-3xl font-medium leading-snug tracking-tight text-slate-900">
              Turn scattered references into one clear creative direction.
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-500">
              Mood Director reads your mood board like an art director and
              writes the prompt for you. See it work — sixty seconds, no
              account.
            </p>
            <button
              onClick={() => setStage(1)}
              className="group mx-auto mt-6 flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Watch it work
              <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
      )}

      {stage >= 1 && stage <= 3 && (
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-5 lg:flex-row">
          {/* canvas side */}
          <div className="flex-1">
            <p className="mb-3 min-h-[2.5rem] text-sm leading-snug text-slate-600">
              {captions[stage]}
            </p>
            <div className="grid grid-cols-3 gap-3">
              {samples.map((s, i) => (
                <div
                  key={i}
                  onClick={() => stage >= 1 && analyzedCount > i && setFlipped(flipped === i ? null : i)}
                  className={`mood-pop-in cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all ${
                    analyzedCount > i ? "opacity-100" : "opacity-0 translate-y-2"
                  }`}
                >
                  {flipped === i ? (
                    <div className="h-40 overflow-y-auto p-2 text-[10px] leading-snug text-slate-600 sm:h-52">
                      {s.analysis}
                    </div>
                  ) : (
                    <img
                      src={s.img}
                      alt=""
                      className="h-40 w-full object-cover sm:h-52"
                      draggable={false}
                    />
                  )}
                  <div className="flex items-center justify-between border-t border-slate-100 px-2 py-1 text-[10px] text-slate-500">
                    <span className={analyzedCount > i ? "text-emerald-600" : ""}>
                      {analyzedCount > i ? "✓ analyzed" : "analyzing…"}
                    </span>
                    <span className="font-mono">
                      {i === 1 ? `${(stage >= 2 ? weight : 1).toFixed(1)}x` : `${s.weight === 0.6 && stage >= 2 ? "0.6" : "1.0"}x`}
                    </span>
                  </div>
                  {i === 1 && stage === 2 && (
                    <div className="border-t border-slate-100 px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.1"
                        value={weight}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setWeight(v);
                          if (v >= 2 && !weightDone) {
                            setWeight(2.3);
                            setWeightDone(true);
                          }
                        }}
                        className="w-full accent-indigo-600"
                      />
                      <p className="text-center text-[9px] uppercase tracking-wide text-slate-400">
                        influence
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {stage === 3 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {TOUR_NOTE_CHOICES.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => setNoteChoice(i)}
                    className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                      noteChoice === i
                        ? "border-amber-400 bg-amber-50 text-amber-900"
                        : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
                    }`}
                  >
                    <StickyNote size={11} className="mr-1.5 inline text-amber-500" />
                    “{c.label}”
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* prompt side */}
          <div className="w-full shrink-0 lg:w-[360px]">
            <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Image-to-text prompt
              </p>
              {showPrompt ? (
                <div key={`${weightDone}-${noteChoice}`} className="mood-pop-in">
                  <TourPrompt segs={promptSegs} />
                </div>
              ) : (
                <p className="flex items-center gap-2 py-4 text-xs text-slate-400">
                  <Loader2 size={13} className="animate-spin" /> fusing the
                  board…
                </p>
              )}
            </div>

            {/* step advance */}
            <div className="mt-3 flex items-center justify-between">
              <span className="flex gap-1.5">
                {[1, 2, 3].map((s) => (
                  <span
                    key={s}
                    className={`h-1.5 w-6 rounded-full ${
                      s < stage ? "bg-indigo-600" : s === stage ? "bg-indigo-400" : "bg-slate-300"
                    }`}
                  />
                ))}
              </span>
              {stage === 1 && showPrompt && (
                <button
                  onClick={() => setStage(2)}
                  disabled={flipped === null}
                  className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  {flipped === null ? "Tap a photo first" : "Next: steer it"}
                  <ArrowRight size={13} />
                </button>
              )}
              {stage === 2 && (
                <button
                  onClick={() => setStage(3)}
                  disabled={!weightDone}
                  className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  {weightDone ? "Next: add your words" : "Drag the slider up"}
                  <ArrowRight size={13} />
                </button>
              )}
              {stage === 3 && (
                <button
                  onClick={() => setStage(4)}
                  disabled={noteChoice === null}
                  className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  {noteChoice === null ? "Pick a note" : "Finish"}
                  <ArrowRight size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {stage === 4 && (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="mood-pop-in max-w-md text-center">
            <h2 className="font-serif text-2xl font-medium leading-snug tracking-tight text-slate-900">
              That's Mood Director.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Every image read like a brief. Every dial yours. Prompts that
              rebuild themselves as the board changes — plus a remix kit that
              turns any board into reusable style lenses.
            </p>
            <button
              onClick={onFinish}
              className="mx-auto mt-6 flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Enter the beta password <ArrowRight size={15} />
            </button>
            <p className="mt-3 text-[11px] text-slate-400">
              Invite-only while we test — ask the person who sent you here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// Beta entry gate for the hosted web deployment: the whole app sits behind
// the beta password until a valid signed token is present. Desktop builds
// and builds without a proxy URL are unaffected.
function BetaGate({ onUnlock }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      await hostedLogin(password);
      onUnlock();
    } catch (err) {
      setError(err.message || "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#ece9e2] p-4">
      <form
        onSubmit={submit}
        className="mood-pop-in w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl"
      >
        <img src={moodLogo} alt="mood" className="mx-auto h-8 w-auto" />
        <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.34em] text-slate-400">
          Private beta
        </p>
        <p className="mt-4 text-sm leading-relaxed text-slate-500">
          Mood Director is in closed testing. Enter the beta password to
          continue.
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Beta password"
          className="mt-5 w-full rounded-md border border-slate-300 px-3 py-2 text-center text-sm outline-none focus:border-indigo-400"
        />
        {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
        <button
          type="submit"
          disabled={!password || busy}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : "Enter"}
        </button>
      </form>
    </div>
  );
}

// Async bootstrap: IndexedDB loads are async, so gate the app on the first
// read (and the one-time localStorage → IndexedDB migration) finishing.
export default function MoodApp() {
  const [initial, setInitial] = useState(null);
  const [unlocked, setUnlocked] = useState(
    () => !HOSTED_AVAILABLE || isTauri() || !!getHostedToken()
  );
  // Scripted tour runs before the password gate for first-time visitors on
  // the hosted web build; unlocked users and desktop builds never see it.
  const [tourDone, setTourDone] = useState(() => {
    try {
      return !!window.localStorage.getItem(TOUR_KEY);
    } catch {
      return true;
    }
  });
  const finishTour = () => {
    try {
      window.localStorage.setItem(TOUR_KEY, "1");
    } catch {
      /* ignore */
    }
    setTourDone(true);
  };
  useEffect(() => {
    let alive = true;
    loadPersistedStateAsync()
      .then((s) => alive && setInitial(s))
      .catch(() => alive && setInitial(EMPTY_PERSISTED_STATE));
    return () => {
      alive = false;
    };
  }, []);
  if (!unlocked && !tourDone) return <ScriptedTour onFinish={finishTour} />;
  if (!unlocked) return <BetaGate onUnlock={() => setUnlocked(true)} />;
  if (!initial) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#ece9e2]">
        <Loader2 size={22} className="animate-spin text-slate-400" />
      </div>
    );
  }
  return <Mood initialState={initial} />;
}

function Mood({ initialState }) {
  const [boards, setBoards] = useState(initialState.boards);
  const [activeId, setActiveId] = useState(initialState.activeId);
  const [promptLibrary, setPromptLibrary] = useState(initialState.promptLibrary);

  // view transform
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [panning, setPanning] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const dragDepth = useRef(0);

  // ui state
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [toast, setToast] = useState("");
  const [showLibrary, setShowLibrary] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showLmSetup, setShowLmSetup] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  // provider/model config. API keys are deliberately session-only.
  const [config, setConfig] = useState(initialState.config);
  const [showSettings, setShowSettings] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState({ status: "idle", msg: "" });

  // refs
  const viewportRef = useRef(null);
  const fileInputRef = useRef(null);
  const boardsRef = useRef(boards);
  const panRef = useRef(pan);
  const scaleRef = useRef(scale);
  const activeIdRef = useRef(activeId);
  const lastSig = useRef({}); // boardId -> signature of last generated content
  const genToken = useRef({}); // boardId -> async token
  const timers = useRef({}); // boardId -> debounce timer
  // Start the z counter above any persisted item so newly dragged cards
  // always come to the front after a reload.
  const [initialZ] = useState(() =>
    Math.max(
      10,
      ...initialState.boards.flatMap((b) => (b.items || []).map((it) => it.z || 0))
    )
  );
  const zRef = useRef(initialZ);
  const toastTimer = useRef(null);
  const configRef = useRef(config);

  useEffect(() => void (boardsRef.current = boards), [boards]);
  useEffect(() => void (panRef.current = pan), [pan]);
  useEffect(() => void (scaleRef.current = scale), [scale]);
  useEffect(() => void (activeIdRef.current = activeId), [activeId]);
  useEffect(() => void (configRef.current = config), [config]);

  // Seed the incremental-save snapshot with what was just loaded so the
  // first save doesn't rewrite every board.
  const persistPrev = useRef(null);
  if (persistPrev.current === null) {
    persistPrev.current = {
      boards: new Map(initialState.boards.map((b, i) => [b.id, { ref: b, pos: i }])),
    };
  }
  useEffect(() => {
    const t = setTimeout(() => {
      savePersistedStateAsync(
        { boards, activeId, config, promptLibrary },
        persistPrev.current
      ).catch((e) => {
        console.warn("mood could not save local state", e);
        try {
          saveLegacyState({ boards, activeId, config, promptLibrary });
        } catch {
          /* both stores failed — nothing else to try */
        }
      });
    }, 250);
    return () => clearTimeout(t);
  }, [boards, activeId, config, promptLibrary]);

  // First-run onboarding — shown once, re-openable from the header.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!window.localStorage.getItem(ONBOARDING_KEY)) setShowOnboarding(true);
    } catch {
      /* ignore storage access errors */
    }
  }, []);

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    try {
      window.localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  // Escape closes the topmost open modal.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (showLmSetup) setShowLmSetup(false);
      else if (showSettings) setShowSettings(false);
      else if (showHistory) setShowHistory(false);
      else if (showLibrary) setShowLibrary(false);
      else if (showNew) setShowNew(false);
      else if (showOnboarding) dismissOnboarding();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showLmSetup, showSettings, showHistory, showLibrary, showNew, showOnboarding, dismissOnboarding]);

  const anyModalOpen =
    showSettings || showHistory || showLibrary || showNew || showOnboarding || showLmSetup;

  const activeBoard = boards.find((b) => b.id === activeId) || null;

  const flash = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  const testConnection = useCallback(async () => {
    setTestState({ status: "testing", msg: "" });
    try {
      const out = await runCompletion(configRef.current, {
        text: "Reply with the single word: ok",
        maxTokens: 80,
      });
      setTestState({
        status: "ok",
        msg: `Connected. Model replied: "${(out || "").slice(0, 40)}"`,
      });
    } catch (e) {
      setTestState({ status: "fail", msg: e.message || "Request failed" });
    }
  }, []);

  const setCfg = useCallback((patch) => {
    setConfig((c) => ({ ...c, ...patch }));
    setTestState({ status: "idle", msg: "" });
  }, []);

  /* --------- immutable board/item mutators (ref kept in sync) --------- */

  const commit = useCallback((updater) => {
    setBoards((prev) => {
      const next = updater(prev);
      boardsRef.current = next;
      return next;
    });
  }, []);

  const patchBoard = useCallback(
    (id, patch) =>
      commit((prev) =>
        prev.map((b) =>
          b.id === id
            ? { ...b, ...(typeof patch === "function" ? patch(b) : patch) }
            : b
        )
      ),
    [commit]
  );

  const addItem = useCallback(
    (boardId, item) =>
      commit((prev) =>
        prev.map((b) =>
          b.id === boardId ? { ...b, items: [...b.items, item] } : b
        )
      ),
    [commit]
  );

  const updateItem = useCallback(
    (boardId, itemId, patch) =>
      commit((prev) =>
        prev.map((b) =>
          b.id === boardId
            ? {
                ...b,
                items: b.items.map((it) =>
                  it.id === itemId ? { ...it, ...patch } : it
                ),
              }
            : b
        )
      ),
    [commit]
  );

  const removeItem = useCallback(
    (boardId, itemId) =>
      commit((prev) =>
        prev.map((b) =>
          b.id === boardId
            ? { ...b, items: b.items.filter((it) => it.id !== itemId) }
            : b
        )
      ),
    [commit]
  );

  const setOutput = useCallback(
    (id, status, output, error = "") =>
      patchBoard(id, { outputStatus: status, output, outputError: error }),
    [patchBoard]
  );

  // Append a versioned snapshot of each successful prompt, tagged with a
  // human-readable summary of what changed since the previous version.
  const recordHistory = useCallback(
    (boardId, prompt, format, inputs) => {
      commit((prev) =>
        prev.map((b) => {
          if (b.id !== boardId) return b;
          const history = b.history || [];
          const last = history[0];
          const summary = summarizeInputChange(
            last?.inputs,
            inputs,
            last?.format,
            format
          );
          if (
            last &&
            last.prompt === prompt &&
            summary === "Regenerated (no board change)"
          )
            return b;
          const entry = {
            id: uid(),
            ts: new Date().toISOString(),
            prompt,
            format,
            inputs,
            summary,
          };
          return { ...b, history: [entry, ...history].slice(0, MAX_HISTORY) };
        })
      );
    },
    [commit]
  );

  /* ---------------------- output generation ---------------------- */

  const runImageSynth = useCallback(
    async (boardId, references, selectedFormat, notes = []) => {
      const token = (genToken.current[boardId] || 0) + 1;
      genToken.current[boardId] = token;
      try {
        const prompt = await synthesizeImagePrompt(
          configRef.current,
          references,
          selectedFormat || DEFAULT_PROMPT_FORMAT,
          DEFAULT_ASPECT_RATIO,
          notes
        );
        if (genToken.current[boardId] !== token) return;
        setOutput(boardId, "ready", prompt);
        recordHistory(
          boardId,
          prompt,
          selectedFormat || DEFAULT_PROMPT_FORMAT,
          [
            ...references.map((r) => ({
              id: r.id,
              weight: r.weight,
              dimensionWeights: r.dimensionWeights,
              positive: r.positive || "",
              negative: r.negative || "",
              analysis: r.analysis || "",
            })),
            ...notes.map((n) => ({
              id: n.id,
              weight: 1,
              dimensionWeights: { ...DEFAULT_DIMENSION_WEIGHTS },
              positive: "",
              negative: "",
              analysis: "",
              note: n.content || "",
            })),
          ]
        );
      } catch (e) {
        if (genToken.current[boardId] !== token) return;
        setOutput(boardId, "error", "", e.message || "Generation failed");
      }
    },
    [setOutput, recordHistory]
  );

  const runSkill = useCallback(
    async (boardId, notes) => {
      const token = (genToken.current[boardId] || 0) + 1;
      genToken.current[boardId] = token;
      try {
        const md = await generateSkillMd(configRef.current, notes);
        if (genToken.current[boardId] !== token) return;
        setOutput(boardId, "ready", md);
      } catch (e) {
        if (genToken.current[boardId] !== token) return;
        setOutput(boardId, "error", "", e.message || "Generation failed");
      }
    },
    [setOutput]
  );

  const scheduleRegen = useCallback((boardId, fn) => {
    clearTimeout(timers.current[boardId]);
    timers.current[boardId] = setTimeout(fn, REGEN_DELAY);
  }, []);

  // Single source of truth: whenever a board's *content* changes,
  // (re)generate its output. Position changes do not affect content
  // signatures, so moving items never triggers regeneration.
  useEffect(() => {
    boards.forEach((board) => {
      if (board.type === "image") {
        const ready = board.items.filter(
          (it) =>
            it.kind === "image" &&
            it.analysisStatus === "ready" &&
            it.analysis &&
            !it.disabled
        );
        if (ready.length === 0) {
          lastSig.current[board.id] = null;
          if (board.output || board.outputStatus !== "idle")
            setOutput(board.id, "idle", "");
          return;
        }
        const selectedFormat = board.promptFormat || DEFAULT_PROMPT_FORMAT;
        const sig = selectedFormat + "|" + boardContentSig(board);
        // First sight of a board this session with a persisted output:
        // adopt the signature instead of regenerating, so app loads don't
        // re-run every board (and re-bill every synthesis).
        if (
          lastSig.current[board.id] === undefined &&
          board.outputStatus === "ready" &&
          board.output
        ) {
          lastSig.current[board.id] = sig;
          return;
        }
        if (lastSig.current[board.id] !== sig) {
          lastSig.current[board.id] = sig;
          if (board.outputStatus !== "loading")
            setOutput(board.id, "loading", board.output);
          const references = ready.map((r) => ({
            id: r.id,
            weight: clampImageWeight(r.weight),
            dimensionWeights: normalizeDimensionWeights(r.dimensionWeights),
            positive: r.positive || "",
            negative: r.negative || "",
            analysis: r.analysis,
          }));
          const notes = enabledBoardNotes(board).map((n) => ({
            id: n.id,
            content: n.content.trim(),
          }));
          scheduleRegen(board.id, () =>
            runImageSynth(board.id, references, selectedFormat, notes)
          );
        }
      } else {
        const notes = board.items
          .filter((it) => it.kind === "text")
          .map((it) => it.content.trim())
          .filter(Boolean);
        if (notes.length < NOTE_MINIMUM) {
          lastSig.current[board.id] = null;
          if (board.output || board.outputStatus !== "idle")
            setOutput(board.id, "idle", "");
          return;
        }
        const sig =
          "n" + notes.length + "|" + notes.map((n) => n.length + ":" + n).join("§");
        if (lastSig.current[board.id] !== sig) {
          lastSig.current[board.id] = sig;
          if (board.outputStatus !== "loading")
            setOutput(board.id, "loading", board.output);
          scheduleRegen(board.id, () => runSkill(board.id, notes));
        }
      }
    });
  }, [boards, setOutput, scheduleRegen, runImageSynth, runSkill]);

  const handleRegenerate = useCallback(() => {
    const b = boardsRef.current.find((x) => x.id === activeIdRef.current);
    if (!b) return;
    if (b.type === "image") {
      const ready = b.items.filter(
        (it) =>
          it.kind === "image" &&
          it.analysisStatus === "ready" &&
          it.analysis &&
          !it.disabled
      );
      if (!ready.length) return;
      const selectedFormat = b.promptFormat || DEFAULT_PROMPT_FORMAT;
      lastSig.current[b.id] = selectedFormat + "|" + boardContentSig(b);
      setOutput(b.id, "loading", b.output);
      runImageSynth(
        b.id,
        ready.map((r) => ({
          id: r.id,
          weight: clampImageWeight(r.weight),
          dimensionWeights: normalizeDimensionWeights(r.dimensionWeights),
          positive: r.positive || "",
          negative: r.negative || "",
          analysis: r.analysis,
        })),
        selectedFormat,
        enabledBoardNotes(b).map((n) => ({ id: n.id, content: n.content.trim() }))
      );
    } else {
      const notes = b.items
        .filter((it) => it.kind === "text")
        .map((it) => it.content.trim())
        .filter(Boolean);
      if (notes.length < NOTE_MINIMUM) return;
      lastSig.current[b.id] =
        "n" + notes.length + "|" + notes.map((n) => n.length + ":" + n).join("§");
      setOutput(b.id, "loading", b.output);
      runSkill(b.id, notes);
    }
  }, [setOutput, runImageSynth, runSkill]);

  // Build (or rebuild) the remix kit — the board's DNA decomposed into
  // reusable, subject-agnostic prompt lenses.
  const handleBuildRemix = useCallback(async () => {
    const b = boardsRef.current.find((x) => x.id === activeIdRef.current);
    if (!b || b.type !== "image" || b.remixStatus === "loading") return;
    const ready = readyImageRefs(b);
    if (!ready.length) return;
    const sig = boardContentSig(b);
    patchBoard(b.id, { remixStatus: "loading", remixError: "" });
    try {
      const kit = await generateRemixKit(
        configRef.current,
        ready.map((r) => ({
          id: r.id,
          weight: clampImageWeight(r.weight),
          dimensionWeights: normalizeDimensionWeights(r.dimensionWeights),
          positive: r.positive || "",
          negative: r.negative || "",
          analysis: r.analysis,
        })),
        enabledBoardNotes(b).map((n) => ({ id: n.id, content: n.content.trim() }))
      );
      patchBoard(b.id, { remix: kit, remixStatus: "ready", remixSig: sig });
    } catch (e) {
      patchBoard(b.id, {
        remixStatus: "error",
        remixError: e.message || "Remix kit generation failed",
      });
    }
  }, [patchBoard]);

  /* ------------------------- add content ------------------------- */

  const addImage = useCallback(
    async (boardId, file, x, y) => {
      const id = uid();
      try {
        const raw = await readFileAsDataUrl(file);
        const src = await downscaleDataUrl(raw, 1024, 0.85);
        addItem(boardId, {
          id,
          kind: "image",
          src,
          x,
          y,
          z: ++zRef.current,
          weight: IMAGE_WEIGHT_DEFAULT,
          dimensionWeights: { ...DEFAULT_DIMENSION_WEIGHTS },
          positive: "",
          negative: "",
          disabled: false,
          analysis: null,
          analysisStatus: "loading",
        });
        try {
          const analysis = await analyzeImage(configRef.current, src);
          updateItem(boardId, id, { analysis, analysisStatus: "ready" });
        } catch (e) {
          updateItem(boardId, id, {
            analysisStatus: "error",
            analysisError: e.message,
          });
          flash("Image analysis failed — check API access.");
        }
      } catch {
        flash("Could not read that image file.");
      }
    },
    [addItem, updateItem, flash]
  );

  const addNote = useCallback(
    (boardId, content, x, y) => {
      addItem(boardId, {
        id: uid(),
        kind: "text",
        content,
        x,
        y,
        z: ++zRef.current,
      });
    },
    [addItem]
  );

  const handleImageWeightChange = useCallback(
    (itemId, weight) => {
      if (!activeIdRef.current) return;
      updateItem(activeIdRef.current, itemId, { weight: clampImageWeight(weight) });
    },
    [updateItem]
  );

  const handleDimensionWeightChange = useCallback(
    (itemId, key, weight) => {
      if (!activeIdRef.current) return;
      const board = boardsRef.current.find((b) => b.id === activeIdRef.current);
      const item = board?.items.find((it) => it.id === itemId);
      const current = normalizeDimensionWeights(item?.dimensionWeights);
      updateItem(activeIdRef.current, itemId, {
        dimensionWeights: {
          ...current,
          [key]: clampImageWeight(weight),
        },
      });
    },
    [updateItem]
  );

  const handleImageFieldChange = useCallback(
    (itemId, patch) => {
      if (!activeIdRef.current) return;
      updateItem(activeIdRef.current, itemId, patch);
    },
    [updateItem]
  );

  const handleToggleDisabled = useCallback(
    (itemId) => {
      const boardId = activeIdRef.current;
      if (!boardId) return;
      const board = boardsRef.current.find((b) => b.id === boardId);
      const item = board?.items.find((it) => it.id === itemId);
      updateItem(boardId, itemId, { disabled: !item?.disabled });
    },
    [updateItem]
  );

  // Re-run analysis on a single image — recovers failed analyses and picks
  // up analysis-prompt improvements without re-dropping the file.
  const handleReanalyze = useCallback(
    async (itemId) => {
      const boardId = activeIdRef.current;
      const board = boardsRef.current.find((b) => b.id === boardId);
      const item = board?.items.find((it) => it.id === itemId);
      if (!board || !item?.src || item.analysisStatus === "loading") return;
      updateItem(boardId, itemId, { analysisStatus: "loading", analysisError: "" });
      try {
        const analysis = await analyzeImage(configRef.current, item.src);
        updateItem(boardId, itemId, { analysis, analysisStatus: "ready" });
      } catch (e) {
        updateItem(boardId, itemId, {
          analysisStatus: "error",
          analysisError: e.message,
        });
        flash("Image analysis failed — check API access.");
      }
    },
    [updateItem, flash]
  );

  const handleNoteChange = useCallback(
    (itemId, content) => {
      if (!activeIdRef.current) return;
      updateItem(activeIdRef.current, itemId, { content });
    },
    [updateItem]
  );

  const centerWorld = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: (r.width / 2 - panRef.current.x) / scaleRef.current - 110,
      y: (r.height / 2 - panRef.current.y) / scaleRef.current - 70,
    };
  }, []);

  // Paste images from the clipboard straight onto the active image board.
  useEffect(() => {
    const onPaste = (e) => {
      if (anyModalOpen) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const board = boardsRef.current.find((b) => b.id === activeIdRef.current);
      if (!board || board.type !== "image") return;
      const files = Array.from(e.clipboardData?.files || []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (!files.length) return;
      e.preventDefault();
      const c = centerWorld();
      files.forEach((f, i) => addImage(board.id, f, c.x + i * 26, c.y + i * 26));
      flash(`Pasted ${files.length} image${files.length > 1 ? "s" : ""}.`);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [anyModalOpen, addImage, centerWorld, flash]);

  /* ----------------------- drag & drop in ----------------------- */

  const worldPointFromEvent = useCallback((clientX, clientY) => {
    const r = viewportRef.current.getBoundingClientRect();
    return {
      x: (clientX - r.left - panRef.current.x) / scaleRef.current,
      y: (clientY - r.top - panRef.current.y) / scaleRef.current,
    };
  }, []);

  const onDrop = useCallback(
    async (e) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDropActive(false);
      const board = boardsRef.current.find((b) => b.id === activeIdRef.current);
      if (!board) return;
      const p = worldPointFromEvent(e.clientX, e.clientY);
      const files = Array.from(e.dataTransfer.files || []);

      if (board.type === "image") {
        const imgs = files.filter((f) => f.type.startsWith("image/"));
        if (!imgs.length) {
          flash("This is an image board — drop image files here.");
          return;
        }
        imgs.forEach((f, i) => addImage(board.id, f, p.x + i * 26, p.y + i * 26));
      } else {
        const textFiles = files.filter(
          (f) =>
            f.type.startsWith("text/") || /\.(txt|md|markdown)$/i.test(f.name)
        );
        if (textFiles.length) {
          for (let i = 0; i < textFiles.length; i++) {
            try {
              const txt = await readFileAsText(textFiles[i]);
              if (txt.trim())
                addNote(board.id, txt.trim(), p.x + i * 26, p.y + i * 26);
            } catch {
              /* ignore */
            }
          }
        } else {
          const txt =
            e.dataTransfer.getData("text/plain") ||
            e.dataTransfer.getData("text") ||
            "";
          if (txt.trim()) addNote(board.id, txt.trim(), p.x, p.y);
          else flash("Drop a text file or selected text onto a text board.");
        }
      }
    },
    [addImage, addNote, worldPointFromEvent, flash]
  );

  const onUploadFiles = useCallback(
    (e) => {
      const board = boardsRef.current.find((b) => b.id === activeIdRef.current);
      const files = Array.from(e.target.files || []);
      if (board && board.type === "image") {
        const c = centerWorld();
        files
          .filter((f) => f.type.startsWith("image/"))
          .forEach((f, i) => addImage(board.id, f, c.x + i * 26, c.y + i * 26));
      }
      e.target.value = "";
    },
    [addImage, centerWorld]
  );

  /* ----------------------- canvas movement ---------------------- */

  const startItemDrag = useCallback(
    (e, item) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const boardId = activeIdRef.current;
      const startX = e.clientX,
        startY = e.clientY;
      const ox = item.x,
        oy = item.y;
      const z = ++zRef.current;
      updateItem(boardId, item.id, { z });
      const move = (ev) => {
        const dx = (ev.clientX - startX) / scaleRef.current;
        const dy = (ev.clientY - startY) / scaleRef.current;
        updateItem(boardId, item.id, { x: ox + dx, y: oy + dy });
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [updateItem]
  );

  const startPan = useCallback(
    (e) => {
      if (e.button !== 0) return;
      const startX = e.clientX,
        startY = e.clientY;
      const op = { ...panRef.current };
      setPanning(true);
      const move = (ev) =>
        setPan({ x: op.x + (ev.clientX - startX), y: op.y + (ev.clientY - startY) });
      const up = () => {
        setPanning(false);
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    []
  );

  // native, non-passive wheel handler for pan + ctrl/⌘ zoom
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const p = panRef.current;
      const s = scaleRef.current;
      if (e.ctrlKey || e.metaKey) {
        const ns = clamp(s * (1 - e.deltaY * 0.0015), 0.2, 3);
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        const wx = (cx - p.x) / s;
        const wy = (cy - p.y) / s;
        setScale(ns);
        setPan({ x: cx - wx * ns, y: cy - wy * ns });
      } else {
        setPan({ x: p.x - e.deltaX, y: p.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [activeId]);

  const zoomBy = (factor) => {
    const el = viewportRef.current;
    const r = el.getBoundingClientRect();
    const cx = r.width / 2,
      cy = r.height / 2;
    const s = scaleRef.current;
    const ns = clamp(s * factor, 0.2, 3);
    const p = panRef.current;
    const wx = (cx - p.x) / s;
    const wy = (cy - p.y) / s;
    setScale(ns);
    setPan({ x: cx - wx * ns, y: cy - wy * ns });
  };

  const resetView = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  // Zoom + pan so every item on the active board is visible.
  const fitView = () => {
    const el = viewportRef.current;
    const board = boardsRef.current.find((b) => b.id === activeIdRef.current);
    const items = board?.items || [];
    if (!el || !items.length) return resetView();
    const CARD_W = 220;
    const CARD_H = 280; // card width is fixed; height varies — close enough to frame
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    items.forEach((it) => {
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + CARD_W);
      maxY = Math.max(maxY, it.y + CARD_H);
    });
    const r = el.getBoundingClientRect();
    const pad = 60;
    const ns = clamp(
      Math.min(r.width / (maxX - minX + pad * 2), r.height / (maxY - minY + pad * 2)),
      0.2,
      1.5
    );
    setScale(ns);
    setPan({
      x: (r.width - (maxX - minX) * ns) / 2 - minX * ns,
      y: (r.height - (maxY - minY) * ns) / 2 - minY * ns,
    });
  };

  /* ------------------------- board ops -------------------------- */

  const createBoard = () => {
    const name = newName.trim() || "Untitled board";
    const board = {
      id: uid(),
      name,
      type: "image",
      promptFormat: DEFAULT_PROMPT_FORMAT,
      items: [],
      output: "",
      outputStatus: "idle",
      outputError: "",
    };
    commit((prev) => [...prev, board]);
    setActiveId(board.id);
    setShowNew(false);
    setNewName("");
    resetView();
  };

  // Guided first board: pre-seeded with three bundled sample photos whose
  // analyses, weights, fused prompt, and history are all precomputed — the
  // full workflow demonstrates itself instantly and costs zero model calls.
  // The seeded signature keeps auto-synthesis idle until the user actually
  // changes something, at which point live generation takes over.
  const createFirstBoard = useCallback(async () => {
    const boardId = uid();
    let srcs = null;
    try {
      srcs = await Promise.all(
        DEMO_SAMPLES.map(async (s) => {
          const blob = await (await fetch(s.img)).blob();
          const raw = await readFileAsDataUrl(blob);
          return downscaleDataUrl(raw, 1024, 0.85);
        })
      );
    } catch {
      /* fall back to an empty board below */
    }
    if (!srcs) {
      commit((prev) => [
        ...prev,
        {
          id: boardId,
          name: "My first board",
          type: "image",
          promptFormat: DEFAULT_PROMPT_FORMAT,
          items: [],
          output: "",
          outputStatus: "idle",
          outputError: "",
        },
      ]);
      setActiveId(boardId);
      flash("Couldn't load the sample images — drop your own to begin.");
      return;
    }

    const imageItems = DEMO_SAMPLES.map((s, i) => ({
      id: uid(),
      kind: "image",
      src: srcs[i],
      x: s.x,
      y: 60,
      z: ++zRef.current,
      weight: s.weight,
      dimensionWeights: { ...DEFAULT_DIMENSION_WEIGHTS, ...s.dims },
      positive: "",
      negative: "",
      disabled: false,
      analysis: s.analysis,
      analysisStatus: "ready",
    }));
    const noteItem = {
      id: uid(),
      kind: "text",
      content: DEMO_NOTE,
      x: 40,
      y: 60,
      z: ++zRef.current,
      disabled: true, // walkthrough text — never part of the prompt
    };
    // History tells the weight story: v1 with everything at 1.0, then the
    // current v2 after the sunset was raised to lead.
    const refsFor = (weights) =>
      imageItems.map((it, i) => ({
        id: it.id,
        weight: weights ? weights[i] : it.weight,
        dimensionWeights: it.dimensionWeights,
        positive: "",
        negative: "",
        analysis: it.analysis,
      }));
    const now = Date.now();
    const history = [
      {
        id: uid(),
        ts: new Date(now).toISOString(),
        prompt: DEMO_PROMPT_V2,
        format: DEFAULT_PROMPT_FORMAT,
        inputs: refsFor(null),
        summary: "1 weight changed",
      },
      {
        id: uid(),
        ts: new Date(now - 60_000).toISOString(),
        prompt: DEMO_PROMPT_V1,
        format: DEFAULT_PROMPT_FORMAT,
        inputs: refsFor([1.0, 1.0, 1.0]),
        summary: "First synthesis — 3 images, equal weights",
      },
    ];
    const board = {
      id: boardId,
      name: "My first board",
      type: "image",
      promptFormat: DEFAULT_PROMPT_FORMAT,
      items: [noteItem, ...imageItems],
      output: DEMO_PROMPT_V2,
      outputStatus: "ready",
      outputError: "",
      history,
    };
    // Mark the canned output as current so the synthesis effect stays idle
    // until the user changes something.
    lastSig.current[boardId] =
      DEFAULT_PROMPT_FORMAT + "|" + boardContentSig(board);
    commit((prev) => [...prev, board]);
    setActiveId(boardId);
  }, [commit, flash]);

  const selectBoard = (id) => {
    setActiveId(id);
    resetView();
  };

  const commitRename = (id) => {
    const n = editName.trim();
    if (n) patchBoard(id, { name: n });
    setEditingId(null);
    setEditName("");
  };

  const deleteBoard = (id) => {
    if (!window.confirm("Delete this board and all its content?")) return;
    commit((prev) => prev.filter((b) => b.id !== id));
    delete lastSig.current[id];
    if (activeIdRef.current === id) {
      const remaining = boardsRef.current;
      setActiveId(remaining.length ? remaining[0].id : null);
    }
  };

  const exportBoard = async (id) => {
    const board = boardsRef.current.find((b) => b.id === id);
    if (!board) return;
    try {
      if (await exportBoardToFile(board)) flash(`Exported "${board.name}".`);
    } catch (e) {
      flash(`Export failed: ${e.message}`);
    }
  };

  const importInputRef = useRef(null);
  const onImportBoardFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const board = parseBoardFile(await file.text());
      commit((prev) => [...prev, board]);
      setActiveId(board.id);
      flash(`Imported "${board.name}".`);
    } catch {
      flash("Import failed — not a valid .moodboard file.");
    }
  };

  const copyOutput = () => {
    if (activeBoard?.output)
      navigator.clipboard?.writeText(activeBoard.output).then(
        () => flash("Copied to clipboard."),
        () => flash("Copy failed.")
      );
  };

  const restoreVersion = (prompt) => {
    const id = activeIdRef.current;
    if (!id) return;
    setOutput(id, "ready", prompt);
    flash("Restored this prompt version.");
  };

  const savePromptCard = () => {
    if (!activeBoard || activeBoard.type !== "image") {
      flash("Prompt cards are for image boards.");
      return;
    }
    if (!activeBoard.output?.trim()) {
      flash("Generate a prompt before saving a card.");
      return;
    }
    const heroImages = getHeroImagesForBoard(activeBoard);
    if (!heroImages.length) {
      flash("Add at least one image before saving a card.");
      return;
    }
    const card = {
      ...createPromptLibraryCard(activeBoard, configRef.current.provider),
      heroImages,
    };
    setPromptLibrary((prev) => [card, ...prev]);
    setShowLibrary(true);
    flash("Saved to prompt library.");
  };

  const copyLibraryPrompt = (prompt) => {
    navigator.clipboard?.writeText(prompt).then(
      () => flash("Prompt copied."),
      () => flash("Copy failed.")
    );
  };

  const deleteLibraryCard = (id) => {
    setPromptLibrary((prev) => prev.filter((card) => card.id !== id));
  };

  const downloadSkill = () => {
    if (!activeBoard?.output) return;
    const blob = new Blob([activeBoard.output], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "skill.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  /* --------------------- derived render data -------------------- */

  const imageItems = activeBoard
    ? activeBoard.items.filter((i) => i.kind === "image")
    : [];
  const imageCount = imageItems.length;
  const activeImageItems = imageItems.filter((i) => !i.disabled);
  const activeImageCount = activeImageItems.length;
  const hiddenImageCount = imageCount - activeImageCount;
  const analyzingCount = activeImageItems.filter(
    (i) => i.analysisStatus === "loading"
  ).length;
  const totalImageWeight = activeImageItems.reduce(
    (sum, i) => sum + clampImageWeight(i.weight),
    0
  );
  const noteCount = activeBoard
    ? activeBoard.items.filter(
        (i) => i.kind === "text" && i.content.trim()
      ).length
    : 0;
  const historyCount = activeBoard?.history?.length || 0;

  /* ----------------------------- UI ----------------------------- */

  return (
    <div className="flex h-screen w-full flex-col bg-slate-100 text-slate-800">
      {/* top bar */}
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white/80 px-5 py-3 backdrop-blur">
        <button
          onClick={() => setLeftOpen((v) => !v)}
          className="flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
          title={leftOpen ? "Hide boards panel" : "Show boards panel"}
          aria-label={leftOpen ? "Hide boards panel" : "Show boards panel"}
        >
          {leftOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <img src={moodLogo} alt="mood" className="h-7 w-auto" />
        <span className="hidden h-5 w-px bg-slate-200 sm:block" />
        <span className="hidden text-[10px] font-medium uppercase tracking-[0.32em] text-slate-400 sm:block">
          Director
        </span>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          {activeBoard && (
            <>
              <span className="hidden items-center gap-2 md:flex">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium uppercase tracking-wide text-[10px] text-slate-500">
                  Image board
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  {(scale * 100).toFixed(0)}%
                </span>
              </span>
              <span className="h-5 w-px bg-slate-200" />
            </>
          )}
          <button
            onClick={() => setShowLibrary(true)}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
            title="Prompt library"
          >
            <Library size={13} />
            <span>Library</span>
            {promptLibrary.length > 0 && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                {promptLibrary.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
            title="Analysis provider settings"
          >
            <Settings size={13} />
            <span className="hidden sm:inline">
              {PROVIDERS[config.provider].label}
            </span>
          </button>
          <button
            onClick={() => setShowOnboarding(true)}
            className="flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
            title="How mood works"
            aria-label="How mood works"
          >
            <HelpCircle size={15} />
          </button>
          <button
            onClick={() => setRightOpen((v) => !v)}
            className="flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
            title={rightOpen ? "Hide prompt panel" : "Show prompt panel"}
            aria-label={rightOpen ? "Hide prompt panel" : "Show prompt panel"}
          >
            {rightOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* left board panel */}
        {leftOpen && (
        <aside className="flex w-60 flex-col border-r border-slate-300 bg-white">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Boards
            </span>
            <span className="flex items-center gap-1">
              <button
                onClick={() => importInputRef.current?.click()}
                className="rounded border border-slate-300 p-1 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                title="Import a .moodboard file"
              >
                <Upload size={13} />
              </button>
              <button
                onClick={() => setShowNew(true)}
                className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
              >
                <Plus size={13} /> New
              </button>
            </span>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept=".moodboard,application/json"
            className="hidden"
            onChange={onImportBoardFile}
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {boards.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-slate-400">
                No boards yet. Create one to start collecting references.
              </p>
            )}
            {boards.map((b) => (
              <div
                key={b.id}
                className={`group mb-1 flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
                  b.id === activeId
                    ? "bg-indigo-50 ring-1 ring-indigo-200"
                    : "hover:bg-slate-50"
                }`}
              >
                {b.type === "image" ? (
                  <ImageIcon size={15} className="shrink-0 text-sky-500" />
                ) : (
                  <FileText size={15} className="shrink-0 text-amber-500" />
                )}
                {editingId === b.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(b.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => commitRename(b.id)}
                    className="min-w-0 flex-1 rounded border border-indigo-300 px-1 py-0.5 text-sm outline-none"
                  />
                ) : (
                  <button
                    onClick={() => selectBoard(b.id)}
                    className="min-w-0 flex-1 truncate text-left"
                    title={b.name}
                  >
                    {b.name}
                  </button>
                )}
                <span className="shrink-0 font-mono text-[10px] text-slate-400 group-hover:hidden">
                  {(b.items || []).filter((it) => it.kind === "image").length}
                </span>
                <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button
                    onClick={() => exportBoard(b.id)}
                    className="rounded p-0.5 text-slate-400 hover:text-indigo-600"
                    title="Export board to a .moodboard file"
                  >
                    <Download size={12} />
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(b.id);
                      setEditName(b.name);
                    }}
                    className="rounded p-0.5 text-slate-400 hover:text-indigo-600"
                    title="Rename"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => deleteBoard(b.id)}
                    className="rounded p-0.5 text-slate-400 hover:text-rose-600"
                    title="Delete board"
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </aside>
        )}

        {/* canvas */}
        <main className="relative min-w-0 flex-1 overflow-hidden">
          {/* canvas toolbar */}
          {activeBoard && (
            <div className="pointer-events-auto absolute left-3 top-3 z-20 flex items-center gap-1 rounded-md border border-slate-300 bg-white/90 p-1 shadow-sm backdrop-blur">
              {activeBoard.type === "image" ? (
                <>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-slate-100"
                  >
                    <Upload size={13} /> Add images
                  </button>
                  <button
                    onClick={() => {
                      const c = centerWorld();
                      addNote(
                        activeBoard.id,
                        "",
                        c.x + (Math.random() * 40 - 20),
                        c.y + (Math.random() * 40 - 20)
                      );
                    }}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-slate-100"
                    title="Notes with the eye open are woven into the prompt"
                  >
                    <StickyNote size={13} /> Add note
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    const c = centerWorld();
                    addNote(
                      activeBoard.id,
                      "",
                      c.x + (Math.random() * 40 - 20),
                      c.y + (Math.random() * 40 - 20)
                    );
                  }}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-slate-100"
                >
                  <Plus size={13} /> Add note
                </button>
              )}
              <span className="mx-1 h-4 w-px bg-slate-200" />
              <button onClick={() => zoomBy(1.2)} className="rounded p-1 hover:bg-slate-100" title="Zoom in">
                <ZoomIn size={14} />
              </button>
              <button onClick={() => zoomBy(1 / 1.2)} className="rounded p-1 hover:bg-slate-100" title="Zoom out">
                <ZoomOut size={14} />
              </button>
              <button onClick={fitView} className="rounded p-1 hover:bg-slate-100" title="Fit all items in view">
                <Maximize2 size={14} />
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onUploadFiles}
          />

          <div
            ref={viewportRef}
            onMouseDown={activeBoard ? startPan : undefined}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={(e) => {
              e.preventDefault();
              if (!activeBoard) return;
              if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
              dragDepth.current += 1;
              setDropActive(true);
            }}
            onDragLeave={() => {
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDropActive(false);
            }}
            onDrop={onDrop}
            className={`absolute inset-0 ${
              panning ? "cursor-grabbing" : activeBoard ? "cursor-grab" : ""
            }`}
            style={{
              backgroundColor: "#ece9e2",
              backgroundImage:
                "radial-gradient(circle, #cdc7b9 1px, transparent 1px)",
              backgroundSize: `${24 * scale}px ${24 * scale}px`,
              backgroundPosition: `${pan.x}px ${pan.y}px`,
            }}
          >
            {!activeBoard ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
                <Sparkles size={40} className="text-slate-300" />
                <p className="text-sm">Create or select a board to begin.</p>
                <button
                  onClick={() =>
                    boardsRef.current.length === 0
                      ? createFirstBoard()
                      : setShowNew(true)
                  }
                  className="flex items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  <Plus size={15} /> Create your first board
                </button>
              </div>
            ) : (
              <>
                {activeBoard.items.length === 0 && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                    {activeBoard.type === "image" ? (
                      <>
                        <ImageIcon size={36} className="mb-2 text-slate-300" />
                        <p className="text-sm">Drag & drop images onto the canvas</p>
                        <p className="text-xs">
                          Each image is analyzed and fused into one prompt.
                        </p>
                      </>
                    ) : (
                      <>
                        <FileText size={36} className="mb-2 text-slate-300" />
                        <p className="text-sm">Drag & drop notes or writing samples</p>
                        <p className="text-xs">
                          Add at least {NOTE_MINIMUM} to generate a skill.md.
                        </p>
                      </>
                    )}
                  </div>
                )}

                <div
                  className="absolute left-0 top-0"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                    transformOrigin: "0 0",
                  }}
                >
                  {activeBoard.items.map((item) =>
                    item.kind === "image" ? (
                      <ImageItem
                        key={item.id}
                        item={item}
                        onStartDrag={startItemDrag}
                        onDelete={(id) => removeItem(activeBoard.id, id)}
                        onWeightChange={handleImageWeightChange}
                        onDimensionWeightChange={handleDimensionWeightChange}
                        onFieldChange={handleImageFieldChange}
                        onToggleDisabled={handleToggleDisabled}
                        onReanalyze={handleReanalyze}
                      />
                    ) : (
                      <NoteItem
                        key={item.id}
                        item={item}
                        onStartDrag={startItemDrag}
                        onDelete={(id) => removeItem(activeBoard.id, id)}
                        onChange={handleNoteChange}
                        onToggleDisabled={
                          activeBoard.type === "image"
                            ? handleToggleDisabled
                            : undefined
                        }
                      />
                    )
                  )}
                </div>
              </>
            )}
          </div>

          {dropActive && activeBoard && (
            <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-slate-500/60 bg-slate-900/5">
              <span className="rounded-md bg-slate-900/85 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
                Drop to add to “{activeBoard.name}”
              </span>
            </div>
          )}

          {toast && (
            <div className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded bg-slate-800 px-3 py-1.5 text-xs text-white shadow-lg">
              {toast}
            </div>
          )}
        </main>

        {/* right output panel */}
        {rightOpen && (
        <aside className="flex w-96 flex-col border-l border-slate-300 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {activeBoard?.type === "text"
                ? "skill.md"
                : "Image-to-text prompt"}
            </span>
            {activeBoard && (
              <div className="flex items-center gap-1">
                {activeBoard.type === "image" && historyCount > 0 && (
                  <button
                    onClick={() => setShowHistory(true)}
                    className="flex items-center gap-1 rounded px-1.5 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    title="Prompt history"
                  >
                    <History size={14} />
                    <span className="font-mono text-[10px]">{historyCount}</span>
                  </button>
                )}
                <button
                  onClick={handleRegenerate}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  title="Regenerate"
                >
                  <RefreshCw size={14} />
                </button>
                {activeBoard.output && (
                  <button
                    onClick={copyOutput}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    title="Copy"
                  >
                    <Copy size={14} />
                  </button>
                )}
                {activeBoard.type === "image" && activeBoard.output && (
                  <button
                    onClick={savePromptCard}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    title="Save to prompt library"
                  >
                    <Save size={14} />
                  </button>
                )}
                {activeBoard.type === "text" && activeBoard.output && (
                  <button
                    onClick={downloadSkill}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    title="Download skill.md"
                  >
                    <Download size={14} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* status row */}
          {activeBoard && (
            <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
              {activeBoard.type === "image" ? (
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {activeImageCount} image{activeImageCount === 1 ? "" : "s"}
                    {activeImageCount > 0 && (
                      <span className="ml-1 text-slate-400">
                        · total weight {totalImageWeight.toFixed(1)}
                      </span>
                    )}
                    {hiddenImageCount > 0 && (
                      <span className="ml-1 text-slate-400">
                        · {hiddenImageCount} hidden
                      </span>
                    )}
                    {analyzingCount > 0 && (
                      <span className="ml-1 text-amber-600">
                        · {analyzingCount} analyzing…
                      </span>
                    )}
                  </span>
                  <label className="flex items-center gap-1">
                    <span className="text-slate-400">format</span>
                    <select
                      value={activeBoard.promptFormat || DEFAULT_PROMPT_FORMAT}
                      onChange={(e) =>
                        patchBoard(activeBoard.id, { promptFormat: e.target.value })
                      }
                      className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 outline-none focus:border-indigo-400"
                    >
                      {Object.entries(PROMPT_FORMATS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : (
                <span>
                  {noteCount} / {NOTE_MINIMUM} notes
                  {noteCount >= NOTE_MINIMUM ? " · ready" : " minimum"}
                </span>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {!activeBoard && (
              <p className="text-sm text-slate-400">
                Output for the active board appears here.
              </p>
            )}

            {activeBoard && activeBoard.type === "image" && (
              <ImageOutput
                board={activeBoard}
                analyzing={analyzingCount}
                count={imageCount}
                activeCount={activeImageCount}
              />
            )}

            {activeBoard &&
              activeBoard.type === "image" &&
              activeBoard.outputStatus === "ready" &&
              activeBoard.output && (
                <RemixKit
                  board={activeBoard}
                  onBuild={handleBuildRemix}
                  flash={flash}
                />
              )}

            {activeBoard && activeBoard.type === "text" && (
              <TextOutput board={activeBoard} noteCount={noteCount} />
            )}
          </div>
        </aside>
        )}
      </div>

      {/* new board modal */}
      {showNew && (
        <div className="mood-overlay-in fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="mood-pop-in w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-serif text-xl font-medium tracking-tight text-slate-900">
                New board
              </h2>
              <button
                onClick={() => setShowNew(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                <X size={16} />
              </button>
            </div>

            <label className="mb-1 block text-xs font-medium text-slate-600">
              Board name
            </label>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createBoard()}
              placeholder="e.g. Cabin Winter Mood"
              className="mb-4 w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
            />

            <div className="mb-5 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700">
                <ImageIcon size={17} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">Image board</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
                  Drop references on an infinite canvas and fuse them into one
                  image-generation prompt.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNew(false)}
                className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={createBoard}
                className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Create board
              </button>
            </div>
          </div>
        </div>
      )}

      {showLibrary && (
        <PromptLibraryModal
          cards={promptLibrary}
          onClose={() => setShowLibrary(false)}
          onCopy={copyLibraryPrompt}
          onDelete={deleteLibraryCard}
        />
      )}

      {showHistory && activeBoard && (
        <PromptHistoryModal
          board={activeBoard}
          onClose={() => setShowHistory(false)}
          onCopy={copyLibraryPrompt}
          onRestore={restoreVersion}
        />
      )}

      {showSettings && (
        <SettingsModal
          config={config}
          setCfg={setCfg}
          onClose={() => setShowSettings(false)}
          showKey={showKey}
          setShowKey={setShowKey}
          testConnection={testConnection}
          testState={testState}
          onOpenSetup={() => setShowLmSetup(true)}
        />
      )}

      {showOnboarding && (
        <OnboardingModal
          onClose={dismissOnboarding}
          onCreate={() => {
            dismissOnboarding();
            // First-ever board gets the guided sample; after that, the
            // normal new-board modal.
            if (boardsRef.current.length === 0) createFirstBoard();
            else setShowNew(true);
          }}
          onSetupLocal={() => {
            dismissOnboarding();
            setShowLmSetup(true);
          }}
        />
      )}

      {showLmSetup && (
        <LmStudioSetupModal
          config={config}
          onClose={() => setShowLmSetup(false)}
          onFinish={(model) => {
            setCfg({ provider: "lmstudio", lmStudioModel: model });
            setShowLmSetup(false);
            flash(`Local AI ready — using ${model}.`);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------- onboarding -------------------------- */

const ONBOARDING_STEPS = [
  {
    icon: ImageIcon,
    title: "Image boards",
    body: "Drop reference images onto an infinite canvas. Each one is analyzed and fused into a single, coherent image-generation prompt.",
  },
  {
    icon: SlidersHorizontal,
    title: "Steer the synthesis",
    body: "Weight each reference and dial in character, style, composition and lighting — then export as JSON, FLUX, Ideogram, Midjourney or Deep Director.",
  },
];

function OnboardingModal({ onClose, onCreate, onSetupLocal }) {
  return (
    <div className="mood-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="mood-pop-in relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        {/* masthead */}
        <div className="border-b border-slate-200 bg-slate-50 px-8 pb-7 pt-9 text-center">
          <img src={moodLogo} alt="mood" className="mx-auto h-9 w-auto" />
          <p className="mt-4 text-[10px] font-medium uppercase tracking-[0.34em] text-slate-400">
            Director
          </p>
          <h2 className="mt-3 font-serif text-2xl font-medium leading-snug tracking-tight text-slate-900">
            Turn source material into
            <br />
            model-ready instructions.
          </h2>
        </div>

        {/* steps */}
        <div className="mood-stagger flex flex-col gap-1 px-6 py-5">
          {ONBOARDING_STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <div
                key={step.title}
                className="flex items-start gap-4 rounded-xl px-3 py-3 transition-colors hover:bg-slate-50"
              >
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm">
                  <Icon size={17} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-800">
                    {step.title}
                  </h3>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">
                    {step.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* AI setup — hosted builds need nothing; local builds get the wizard */}
        {HOSTED_AVAILABLE ? (
          <div className="mx-6 mb-4 flex items-center gap-3 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/60 px-4 py-3">
            <Sparkles size={16} className="shrink-0 text-indigo-500" />
            <p className="text-[12px] leading-snug text-slate-600">
              AI is{" "}
              <span className="font-semibold text-indigo-600">included</span>{" "}
              during the beta — drop images and they're analyzed instantly,
              nothing to install or configure.
            </p>
          </div>
        ) : (
          <div className="mx-6 mb-4 flex items-center justify-between gap-3 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/60 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Cpu size={16} className="shrink-0 text-indigo-500" />
              <p className="text-[12px] leading-snug text-slate-600">
                Mood Director runs on free, private AI on your own machine.
                First time? We'll set it up together — about five minutes.
              </p>
            </div>
            <button
              onClick={onSetupLocal}
              className="shrink-0 rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-100"
            >
              Guided setup
            </button>
          </div>
        )}

        {/* actions */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            Explore on my own
          </button>
          <button
            onClick={onCreate}
            className="group flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            Create your first board
            <ArrowRight
              size={15}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------- LM Studio guided setup ------------------- */

const LM_SETUP_MODELS = [
  {
    id: "google/gemma-4-12b",
    label: "Gemma 4 12B",
    detail: "Best quality — for machines with 16 GB+ RAM",
  },
  {
    id: "google/gemma-3-4b",
    label: "Gemma 3 4B",
    detail: "Light and fast — runs comfortably on most machines",
  },
];

function pickRecommendedLmModel() {
  // navigator.deviceMemory is Chrome-only and caps at 8, but it's enough
  // to steer low-RAM machines toward the smaller model.
  const mem = typeof navigator !== "undefined" ? navigator.deviceMemory : null;
  return mem && mem < 8 ? LM_SETUP_MODELS[1].id : LM_SETUP_MODELS[0].id;
}

function SetupStepBadge({ done, index }) {
  return done ? (
    <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-emerald-500" />
  ) : (
    <span className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-semibold text-slate-500">
      {index}
    </span>
  );
}

function LmStudioSetupModal({ config, onClose, onFinish }) {
  const [serverUp, setServerUp] = useState(false);
  const [models, setModels] = useState([]);
  const [chosen, setChosen] = useState(pickRecommendedLmModel);

  // Poll the local server so each step checks itself off live —
  // the user never has to click "verify".
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const list = await listLmStudioModels(config.lmStudioUrl);
        if (!alive) return;
        setServerUp(true);
        setModels(list);
      } catch {
        if (!alive) return;
        setServerUp(false);
        setModels([]);
      }
    };
    poll();
    const t = setInterval(poll, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [config.lmStudioUrl]);

  const modelReady = models.length > 0;
  const allDone = serverUp && modelReady;
  const bestModel = modelReady
    ? models.find((m) => m === chosen) ||
      models.find((m) => /gemma|vision|\bvl\b|llava|pixtral/i.test(m)) ||
      models[0]
    : chosen;

  return (
    <div className="mood-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="mood-pop-in flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="flex items-center gap-2.5 font-serif text-xl font-medium tracking-tight text-slate-900">
            <Cpu size={17} className="text-slate-400" /> Set up local AI
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <p className="mb-4 text-[13px] leading-relaxed text-slate-500">
            Mood Director runs on a free model on your own machine — no
            account, no API key, nothing leaves your computer. This takes
            about five minutes, and each step checks itself off as you go.
          </p>

          {/* step 1 — install & open */}
          <div className="flex items-start gap-3.5 rounded-xl px-2 py-3">
            <SetupStepBadge done={serverUp} index={1} />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-800">
                Install and open LM Studio
              </h3>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
                Free desktop app that runs AI models locally. Install it, open
                it, and skip the model suggestions it shows on first launch.
              </p>
              {!serverUp && (
                <button
                  onClick={() => openExternal("https://lmstudio.ai/download")}
                  className="mt-2 flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Download size={13} /> Download LM Studio
                  <ExternalLink size={11} className="text-slate-400" />
                </button>
              )}
            </div>
          </div>

          {/* step 2 — get a model */}
          <div className="flex items-start gap-3.5 rounded-xl px-2 py-3">
            <SetupStepBadge done={modelReady} index={2} />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-800">
                Get a vision model
              </h3>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
                Mood Director needs a model that can see images. Pick one — the button
                opens it directly in LM Studio, then click{" "}
                <span className="font-medium text-slate-600">Download</span>{" "}
                there.
              </p>
              {!modelReady && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {LM_SETUP_MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setChosen(m.id);
                        // LM Studio's hub deep link takes owner/name separately
                        // (same URL its own website builds).
                        const [owner, name] = m.id.split("/");
                        openExternal(
                          `lmstudio://model?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}`
                        );
                      }}
                      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs ${
                        chosen === m.id
                          ? "border-indigo-400 bg-indigo-50/60"
                          : "border-slate-300 hover:border-slate-400"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-slate-700">
                          {m.label}
                          {chosen === m.id && (
                            <span className="ml-1.5 rounded bg-indigo-100 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-indigo-600">
                              recommended
                            </span>
                          )}
                        </span>
                        <span className="block text-[11px] text-slate-500">
                          {m.detail}
                        </span>
                      </span>
                      <ExternalLink size={12} className="shrink-0 text-slate-400" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* step 3 — start the server */}
          <div className="flex items-start gap-3.5 rounded-xl px-2 py-3">
            <SetupStepBadge done={allDone} index={3} />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-800">
                Load the model and start the server
              </h3>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
                In LM Studio, open the{" "}
                <span className="font-medium text-slate-600">Developer</span>{" "}
                tab, load your downloaded model at the top, and flip the{" "}
                <span className="font-medium text-slate-600">
                  Status: Running
                </span>{" "}
                switch. Mood Director will spot it automatically.
              </p>
              {allDone && (
                <p className="mt-1.5 text-[12px] font-medium text-emerald-600">
                  Connected — found {bestModel}.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
          <span className="flex items-center gap-2 text-[11px] text-slate-400">
            {allDone ? (
              <>
                <CheckCircle2 size={13} className="text-emerald-500" /> Ready to
                go
              </>
            ) : (
              <>
                <Loader2 size={13} className="animate-spin" /> Watching for LM
                Studio…
              </>
            )}
          </span>
          <button
            onClick={() => onFinish(bestModel)}
            disabled={!allDone}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start creating <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------- prompt library ------------------------ */

function PromptLibraryModal({ cards, onClose, onCopy, onDelete }) {
  return (
    <div className="mood-overlay-in fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="mood-pop-in flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="flex items-center gap-2.5 font-serif text-xl font-medium tracking-tight text-slate-900">
            <Library size={17} className="text-slate-400" /> Prompt library
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {cards.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-center text-slate-400">
              <Library size={34} className="mb-2 text-slate-300" />
              <p className="text-sm">No saved prompt cards yet.</p>
              <p className="mt-1 max-w-sm text-xs">
                Generate an image-board prompt, then use the save button in the
                output panel.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {cards.map((card) => (
                <article
                  key={card.id}
                  className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
                >
                  <div className="grid h-40 grid-cols-3 bg-slate-100">
                    {(card.heroImages || []).map((img, index) => (
                      <img
                        key={`${card.id}-${img.id}-${index}`}
                        src={img.src}
                        alt=""
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    ))}
                  </div>

                  <div className="border-b border-slate-100 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-slate-800">
                          {card.title}
                        </h3>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {PROMPT_FORMATS[card.promptFormat] || card.promptFormat} ·{" "}
                          {card.provider} · {formatShortDate(card.createdAt)}
                        </p>
                      </div>
                      <button
                        onClick={() => onDelete(card.id)}
                        className="shrink-0 rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title="Delete card"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <Code2 size={12} /> prompt
                      </span>
                      <button
                        onClick={() => onCopy(card.prompt)}
                        className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                        title="Copy prompt"
                      >
                        <Copy size={12} /> Copy
                      </button>
                    </div>
                    <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
                      {card.prompt}
                    </pre>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------ settings modal ----------------------- */

function ProviderIcon({ name, size = 18, className = "" }) {
  if (name === "sparkles") return <Sparkles size={size} className={className} />;
  if (name === "cpu") return <Cpu size={size} className={className} />;
  return <Cloud size={size} className={className} />;
}

function TextField({ label, hint, value, onChange, type = "text", placeholder }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
      />
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

// Beta password / session state inside the hosted provider card. On desktop
// (no entry gate) this is also where the password gets entered.
function HostedAccessControls({ active, onUseHosted }) {
  const [hasToken, setHasToken] = useState(() => !!getHostedToken());
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const unlock = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      await hostedLogin(password);
      setHasToken(true);
      setPassword("");
    } catch (e) {
      setError(e.message || "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  if (!hasToken) {
    return (
      <div className="mt-2.5">
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && unlock()}
            placeholder="Beta password"
            className="min-w-0 flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
          />
          <button
            onClick={unlock}
            disabled={!password || busy}
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : "Unlock"}
          </button>
        </div>
        {error ? (
          <p className="mt-1.5 text-[11px] text-rose-600">{error}</p>
        ) : (
          <p className="mt-1.5 text-[11px] text-slate-400">
            Closed beta — the hosted model needs the beta password.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2.5">
      {active ? (
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-600">
          <CheckCircle2 size={12} /> Active — beta access unlocked
        </p>
      ) : (
        <button
          onClick={onUseHosted}
          className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          Use hosted model
        </button>
      )}
      <button
        onClick={() => {
          window.localStorage.removeItem(HOSTED_TOKEN_KEY);
          setHasToken(false);
        }}
        className="mt-1.5 text-[11px] text-slate-400 underline hover:text-slate-600"
      >
        Sign out / switch password
      </button>
    </div>
  );
}

function SettingsModal({
  config,
  setCfg,
  onClose,
  showKey,
  setShowKey,
  testConnection,
  testState,
  onOpenSetup,
}) {
  const p = config.provider;
  const [lmModels, setLmModels] = useState([]);
  const [lmModelsState, setLmModelsState] = useState({ status: "idle", msg: "" });

  const loadLmModels = async () => {
    setLmModelsState({ status: "loading", msg: "" });
    try {
      const models = await listLmStudioModels(config.lmStudioUrl);
      setLmModels(models);
      setLmModelsState({
        status: "ok",
        msg: models.length ? `${models.length} model${models.length === 1 ? "" : "s"}` : "No models returned",
      });
      if (models.length && !models.includes(config.lmStudioModel)) {
        setCfg({ lmStudioModel: models[0] });
      }
    } catch (e) {
      setLmModelsState({ status: "fail", msg: e.message || "Could not load models" });
    }
  };

  return (
    <div className="mood-overlay-in fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="mood-pop-in flex max-h-[88vh] w-full max-w-lg flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="flex items-center gap-2.5 font-serif text-xl font-medium tracking-tight text-slate-900">
            <Settings size={17} className="text-slate-400" /> Analysis provider
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-xs text-slate-500">
            Choose which model analyzes images and generates output. This applies
            to every board.
          </p>

          {/* hosted */}
          <div
            className={`mb-4 rounded-xl border p-3.5 ${
              p === "hosted"
                ? "border-indigo-400 bg-indigo-50/50 ring-1 ring-indigo-200"
                : "border-slate-200 bg-slate-50/60"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Sparkles size={15} className="text-indigo-500" /> Mood Director
                hosted
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                free during beta
              </span>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
              Zero setup — a fast vision model we host for you. No key, no
              install, works immediately.
            </p>
            {HOSTED_AVAILABLE ? (
              <HostedAccessControls
                active={p === "hosted"}
                onUseHosted={() => setCfg({ provider: "hosted" })}
              />
            ) : (
              <p className="mt-2 rounded-md bg-amber-50 p-2 text-[11px] text-amber-800">
                Not available in this build — use a provider below.
              </p>
            )}
          </div>

          {/* bring your own */}
          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Bring your own model
            </span>
            <select
              value={BYO_PROVIDERS.includes(p) ? p : ""}
              onChange={(e) => e.target.value && setCfg({ provider: e.target.value })}
              className="w-full rounded border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-indigo-400"
            >
              <option value="" disabled>
                Choose a provider…
              </option>
              {BYO_PROVIDERS.filter(
                (key) =>
                  key === p ||
                  !LOCAL_PROVIDERS_BLOCKED ||
                  (key !== "lmstudio" && key !== "ollama")
              ).map((key) => (
                <option key={key} value={key}>
                  {PROVIDERS[key].label}
                </option>
              ))}
            </select>
          </label>

          {p === "anthropic" && (
            <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
              Uses the built-in Claude API — no key required. Only available
              when Mood Director runs inside Claude.ai; in the desktop app use a local
              or API-key provider instead.
            </div>
          )}

          {p === "openai" && (
            <div>
              <div className="relative">
                <TextField
                  label="OpenAI API key"
                  type={showKey ? "text" : "password"}
                  value={config.openaiKey}
                  onChange={(v) => setCfg({ openaiKey: v })}
                  placeholder="sk-…"
                  hint="Sent directly from your browser to api.openai.com."
                />
                <button
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2 top-7 text-slate-400 hover:text-slate-600"
                  title={showKey ? "Hide" : "Show"}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <TextField
                label="Model"
                value={config.openaiModel}
                onChange={(v) => setCfg({ openaiModel: v })}
                placeholder="gpt-4o-mini"
                hint="Use a vision-capable model (e.g. gpt-4o, gpt-4o-mini) so image boards work."
              />
            </div>
          )}

          {p === "gemini" && (
            <div>
              <div className="relative">
                <TextField
                  label="Gemini API key"
                  type={showKey ? "text" : "password"}
                  value={config.geminiKey}
                  onChange={(v) => setCfg({ geminiKey: v })}
                  placeholder="AIza…"
                  hint="Sent directly from your browser to generativelanguage.googleapis.com."
                />
                <button
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2 top-7 text-slate-400 hover:text-slate-600"
                  title={showKey ? "Hide" : "Show"}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <TextField
                label="Model"
                value={config.geminiModel}
                onChange={(v) => setCfg({ geminiModel: v })}
                placeholder="gemini-2.5-flash"
                hint="Use a current multimodal model, e.g. gemini-2.5-flash or gemini-2.5-pro (both handle vision + text)."
              />
            </div>
          )}

          {p === "lmstudio" && (
            <div>
              <button
                onClick={onOpenSetup}
                className="mb-3 flex w-full items-center justify-between gap-2 rounded-md border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-left text-xs text-slate-600 transition-colors hover:bg-indigo-100"
              >
                <span>
                  <span className="font-semibold text-indigo-600">
                    New to LM Studio?
                  </span>{" "}
                  Guided setup installs it and picks a model with you.
                </span>
                <ArrowRight size={13} className="shrink-0 text-indigo-500" />
              </button>
              <TextField
                label="LM Studio API path"
                value={config.lmStudioUrl}
                onChange={(v) => setCfg({ lmStudioUrl: v })}
                placeholder="/api/lmstudio"
                hint="Use /api/lmstudio for the built-in local proxy. Direct LM Studio URLs need CORS enabled."
              />
              <TextField
                label="Model"
                value={config.lmStudioModel}
                onChange={(v) => setCfg({ lmStudioModel: v })}
                placeholder="google/gemma-4-12b"
                hint="For image boards, load a vision-capable model in LM Studio."
              />
              <div className="mb-3 flex items-center gap-2">
                <button
                  onClick={loadLmModels}
                  disabled={lmModelsState.status === "loading"}
                  className="flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
                >
                  {lmModelsState.status === "loading" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Plug size={14} />
                  )}
                  Load models
                </button>
                {lmModelsState.status === "ok" && (
                  <span className="text-xs text-emerald-600">{lmModelsState.msg}</span>
                )}
                {lmModelsState.status === "fail" && (
                  <span className="text-xs text-rose-600">{lmModelsState.msg}</span>
                )}
              </div>
              {lmModels.length > 0 && (
                <label className="mb-3 block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">
                    Loaded model
                  </span>
                  <select
                    value={config.lmStudioModel}
                    onChange={(e) => setCfg({ lmStudioModel: e.target.value })}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
                  >
                    {lmModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="rounded-md bg-amber-50 p-2.5 text-[11px] text-amber-800">
                Start the LM Studio local server before testing. The local
                proxy forwards this app's requests to http://127.0.0.1:1234/v1.
              </div>
            </div>
          )}

          {p === "ollama" && (
            <div>
              <TextField
                label="Ollama base URL"
                value={config.ollamaUrl}
                onChange={(v) => setCfg({ ollamaUrl: v })}
                placeholder="http://localhost:11434"
              />
              <TextField
                label="Text model (prompt synthesis)"
                value={config.ollamaModel}
                onChange={(v) => setCfg({ ollamaModel: v })}
                placeholder="llama3.1"
              />
              <TextField
                label="Vision model (image analysis)"
                value={config.ollamaVisionModel}
                onChange={(v) => setCfg({ ollamaVisionModel: v })}
                placeholder="llava"
                hint="Must be a vision model (e.g. llava, llama3.2-vision, bakllava)."
              />
              <div className="rounded-md bg-amber-50 p-2.5 text-[11px] text-amber-800">
                For browser access, start Ollama with CORS allowed, e.g.
                <code className="mx-1 rounded bg-amber-100 px-1">
                  OLLAMA_ORIGINS=* ollama serve
                </code>
                . If the app is served over https, calling http://localhost is
                blocked as mixed content — run mood over http locally.
              </div>
            </div>
          )}

          {/* test connection */}
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={testConnection}
              disabled={testState.status === "testing"}
              className="flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
            >
              {testState.status === "testing" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plug size={14} />
              )}
              Test connection
            </button>
            {testState.status === "ok" && (
              <span className="text-xs text-emerald-600">{testState.msg}</span>
            )}
            {testState.status === "fail" && (
              <span className="text-xs text-rose-600">{testState.msg}</span>
            )}
          </div>

          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
            <Server size={12} className="mr-1 inline" />
            API keys live only in memory for this session and are sent straight
            from your browser to the provider. Boards, provider selection, model
            names, and prompt-library cards are saved locally on this device
            (IndexedDB). Use a board's export button to back it up as a
            .moodboard file.
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-200 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------- output sub-views ---------------------- */

/* ----------------------- prompt history modal ------------------ */

function PromptHistoryModal({ board, onClose, onCopy, onRestore }) {
  const history = board.history || [];
  const [selectedId, setSelectedId] = useState(history[0]?.id);
  const [showDiff, setShowDiff] = useState(false);
  const selected = history.find((h) => h.id === selectedId) || history[0];
  const current = board.output || "";
  const isLatest = selected && history[0] && selected.id === history[0].id;

  return (
    <div className="mood-overlay-in fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="mood-pop-in flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="flex items-center gap-2.5 font-serif text-xl font-medium tracking-tight text-slate-900">
            <History size={17} className="text-slate-400" /> Prompt history
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {history.length === 0 || !selected ? (
          <div className="p-12 text-center text-sm text-slate-400">
            No prompt versions yet.
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr] overflow-hidden">
            {/* version list */}
            <div className="min-h-0 overflow-y-auto border-r border-slate-200 p-2">
              {history.map((h, idx) => (
                <button
                  key={h.id}
                  onClick={() => setSelectedId(h.id)}
                  className={`mb-1 block w-full rounded-lg px-3 py-2 text-left transition-colors ${
                    h.id === selected.id
                      ? "bg-slate-100 ring-1 ring-slate-200"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-700">
                      {idx === 0 ? "Latest" : formatShortDate(h.ts)}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-wide text-slate-400">
                      {PROMPT_FORMATS[h.format] || h.format}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">
                    {h.summary}
                  </p>
                </button>
              ))}
            </div>

            {/* detail */}
            <div className="flex min-h-0 flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
                <span className="min-w-0 truncate text-[11px] text-slate-500">
                  {isLatest ? "Latest version" : formatShortDate(selected.ts)} ·{" "}
                  {selected.summary}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setShowDiff((d) => !d)}
                    disabled={!current || isLatest}
                    className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition-colors disabled:opacity-40 ${
                      showDiff
                        ? "border-slate-300 bg-slate-100 text-slate-700"
                        : "border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                    title={
                      isLatest
                        ? "This is the current version"
                        : "Show changes vs the current prompt"
                    }
                  >
                    <GitCompareArrows size={12} /> Diff
                  </button>
                  <button
                    onClick={() => onCopy(selected.prompt)}
                    className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                    title="Copy this version"
                  >
                    <Copy size={12} /> Copy
                  </button>
                  <button
                    onClick={() => {
                      onRestore(selected.prompt);
                      onClose();
                    }}
                    className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700"
                    title="Make this the active prompt"
                  >
                    <RotateCcw size={12} /> Restore
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {showDiff && !isLatest ? (
                  <>
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-800">
                      {diffTokens(selected.prompt, current).map((t, i) => {
                        if (/^\s+$/.test(t.text)) return <span key={i}>{t.text}</span>;
                        if (t.type === "add")
                          return (
                            <span key={i} className="rounded bg-slate-200 text-slate-900">
                              {t.text}
                            </span>
                          );
                        if (t.type === "del")
                          return (
                            <span
                              key={i}
                              className="text-slate-400 line-through decoration-slate-400"
                            >
                              {t.text}
                            </span>
                          );
                        return <span key={i}>{t.text}</span>;
                      })}
                    </p>
                    <p className="mt-4 flex items-center gap-3 text-[10px] text-slate-400">
                      <span className="rounded bg-slate-200 px-1 text-slate-900">added</span>
                      <span className="line-through">removed</span>
                      <span>from this version → current</span>
                    </p>
                  </>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-800">
                    {selected.prompt}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ImageOutput({ board, analyzing, count, activeCount }) {
  if (count === 0)
    return (
      <p className="text-sm text-slate-400">
        Drop images on the canvas to start building a cohesive visual prompt.
      </p>
    );
  if (activeCount === 0)
    return (
      <p className="text-sm text-slate-400">
        All {count} image{count === 1 ? " is" : "s are"} hidden. Click the eye
        icon on an image to include it in the prompt.
      </p>
    );
  if (board.outputStatus === "loading" || (analyzing > 0 && !board.output))
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 size={15} className="animate-spin text-indigo-500" />
        Synthesizing the combined visual direction…
      </div>
    );
  if (board.outputStatus === "error")
    return (
      <p className="text-sm text-rose-600">
        Couldn’t generate the prompt. {board.outputError}
      </p>
    );
  return (
    <div>
      {analyzing > 0 && (
        <p className="mb-2 flex items-center gap-1 text-[11px] text-amber-600">
          <Loader2 size={12} className="animate-spin" />
          {analyzing} more image(s) analyzing — prompt will refine.
        </p>
      )}
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">
        {board.output}
      </p>
    </div>
  );
}

/* Remix kit panel — turns the board from a scene description into a
 * vocabulary: isolated lenses (style, palette, lighting, …) with [SUBJECT]
 * placeholders, ready to point at the user's own subjects. */
function RemixKit({ board, onBuild, flash }) {
  const [lens, setLens] = useState("all");
  const stale =
    board.remixStatus === "ready" && board.remixSig !== boardContentSig(board);
  const fragment = extractRemixLens(board.remix, lens);

  const copyFragment = () => {
    if (!fragment) return;
    navigator.clipboard?.writeText(fragment).then(
      () =>
        flash(
          lens === "all"
            ? "Remix kit copied."
            : `${REMIX_LENSES.find((l) => l.key === lens)?.label} lens copied.`
        ),
      () => flash("Copy failed.")
    );
  };

  return (
    <div className="mt-4 border-t border-slate-200 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <SlidersHorizontal size={12} /> Remix kit
          {stale && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal text-amber-700">
              board changed — rebuild
            </span>
          )}
        </span>
        {board.remixStatus === "ready" && (
          <button
            onClick={onBuild}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Rebuild remix kit"
          >
            <RefreshCw size={13} />
          </button>
        )}
      </div>

      {(!board.remixStatus || board.remixStatus === "idle") && (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
          <p className="text-[12px] leading-relaxed text-slate-500">
            Split this board into reusable lenses — style, palette, lighting,
            composition — with{" "}
            <code className="rounded bg-slate-200 px-1 text-[10px]">
              [SUBJECT]
            </code>{" "}
            slots, so you can apply the board's look to anything you want to
            make next.
          </p>
          <button
            onClick={onBuild}
            className="mt-2 flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            <SlidersHorizontal size={12} /> Build remix kit
          </button>
        </div>
      )}

      {board.remixStatus === "loading" && (
        <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin text-indigo-500" />
          Decomposing the board into lenses…
        </div>
      )}

      {board.remixStatus === "error" && (
        <div className="rounded-md bg-rose-50 p-2.5 text-xs text-rose-700">
          {board.remixError || "Remix kit generation failed."}
          <button
            onClick={onBuild}
            className="ml-2 font-medium underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {board.remixStatus === "ready" && board.remix && (
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <select
              value={lens}
              onChange={(e) => setLens(e.target.value)}
              className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600 outline-none focus:border-indigo-400"
            >
              {REMIX_LENSES.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
            <button
              onClick={copyFragment}
              disabled={!fragment}
              className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              title="Copy this lens"
            >
              <Copy size={11} /> Copy
            </button>
          </div>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-700">
            {fragment || "This lens came back empty — rebuild the kit."}
          </pre>
        </div>
      )}
    </div>
  );
}

function TextOutput({ board, noteCount }) {
  if (noteCount < NOTE_MINIMUM)
    return (
      <div className="text-sm text-slate-500">
        <p className="mb-2">
          Add{" "}
          <span className="font-semibold text-slate-700">
            {NOTE_MINIMUM - noteCount}
          </span>{" "}
          more note{NOTE_MINIMUM - noteCount === 1 ? "" : "s"} to generate the
          first <code className="rounded bg-slate-100 px-1">skill.md</code>.
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded bg-slate-100">
          <div
            className="h-full bg-amber-400 transition-all"
            style={{ width: `${(noteCount / NOTE_MINIMUM) * 100}%` }}
          />
        </div>
      </div>
    );
  if (board.outputStatus === "loading")
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 size={15} className="animate-spin text-indigo-500" />
        Analyzing the combined writing voice…
      </div>
    );
  if (board.outputStatus === "error")
    return (
      <p className="text-sm text-rose-600">
        Couldn’t generate skill.md. {board.outputError}
      </p>
    );
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-slate-800">
      {board.output}
    </pre>
  );
}
