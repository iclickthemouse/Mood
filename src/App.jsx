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
} from "lucide-react";
import moodLogo from "./assets/mood-logo.svg";

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
  anthropic: { label: "Claude (in-artifact)", icon: "sparkles", needsKey: false },
  openai: { label: "OpenAI", icon: "cloud", needsKey: true },
  gemini: { label: "Google Gemini", icon: "cloud", needsKey: true },
  lmstudio: { label: "LM Studio (local)", icon: "cpu", needsKey: false },
  ollama: { label: "Ollama (local)", icon: "cpu", needsKey: false },
};

const DEFAULT_CONFIG = {
  provider: "anthropic",
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
  return next;
}

function loadPersistedState() {
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

function savePersistedState({ boards, activeId, config, promptLibrary }) {
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

// Unified entry point. `images` is an array of data-URLs (may be empty).
async function runCompletion(cfg, { system, text, images = [], maxTokens = 1024 }) {
  switch (cfg.provider) {
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
  if (/verbose_flux_caption/i.test(system) && /PROMPT\s*:/.test(text)) {
    return extractFromMarker(text, /PROMPT\s*:/i);
  }
  if (/midjourney_tags/i.test(system)) {
    const midjourneyMatch = /\/imagine prompt:[\s\S]+/i.exec(text);
    if (midjourneyMatch) return midjourneyMatch[0].trim();
  }
  if (/(json|ideogram_json)/i.test(system)) {
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

const IMAGE_ANALYSIS_SYSTEM =
  "You analyze a single reference image for a visual mood board. In 3-5 sentences of plain text (no preamble, no headings, no markdown), describe: subject matter, composition/framing, dominant colors and palette, textures and materials, lighting, atmosphere/mood, and overall style or aesthetic cues. Be specific, concrete, and evocative.";

const IMAGE_SYNTH_SYSTEM = `You are the mood image distillation agent. You synthesize one image board into one precise image-generation prompt.

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

Always fuse the board into one coherent result. Never list images separately. Never say moodboard, reference image, image 1, image 2, based on the board, or inspired by these images. Avoid generic hype language such as beautiful, stunning, masterpiece, ultra detailed, award winning, and trending. Use concrete visual language: subject, composition, viewpoint, light, palette, texture, atmosphere, medium, finish, and avoidances.

Return exactly the selected format.

json:
Return valid JSON only with keys in this order: schema, format, visual_thesis, prompt, visual_dna, reference_fusion, negative_prompt, generation_hints, quality_checks. Use schema "mood.image_prompt.v1" and format "json". Include prompt.primary, prompt.short, and prompt.expanded. In reference_fusion include anchor_details, supporting_details, outlier_handling, conflicts_resolved, and weighting_decisions.

verbose_flux_caption:
Return plain text only with these exact sections: PROMPT, NEGATIVE PROMPT, STYLE KEYWORDS, PARAMETER NOTES. PROMPT must be one dense caption of 120-260 words. NEGATIVE PROMPT must be one comma-separated line of useful avoidances. STYLE KEYWORDS must be 12-32 comma-separated keywords. PARAMETER NOTES must be 2-5 short notes.

ideogram_json:
Return valid JSON only with keys in this order: high_level_description, style_description, compositional_deconstruction. For photo outputs, style_description key order is aesthetics, lighting, photo, medium, color_palette. For non-photo outputs, style_description key order is aesthetics, lighting, medium, art_style, color_palette. compositional_deconstruction key order is background, elements. Elements use type "obj" or "text". Use bbox arrays as [y_min, x_min, y_max, x_max] on a 0-1000 canvas when placement matters. Hex colors must be uppercase #RRGGBB.

midjourney_tags:
Return one Midjourney-style line only: /imagine prompt: subject-and-scene sentence, comma-separated style tags, composition tags, lighting tags, palette tags, texture tags, atmosphere tags, medium tags --ar aspect_ratio --stylize stylize_value --quality quality_value --chaos chaos_value --no negative_terms. Do not use artist names. Do not add a version flag unless the payload provides one.

Before returning, check that the output has no placeholders, no unresolved notes, no hidden analysis commentary, and no unsupported format.`;

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
    maxTokens: 500,
  });
}

async function synthesizeImagePrompt(
  cfg,
  references,
  selectedFormat = DEFAULT_PROMPT_FORMAT,
  aspectRatio = DEFAULT_ASPECT_RATIO
) {
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
    references: referencesWithDirectives,
  };

  return runCompletion(cfg, {
    system: IMAGE_SYNTH_SYSTEM,
    text:
      `Here are weighted analyses of ${normalized.length} reference image(s) collected on a single image board. ` +
      `Use selected_format=${selectedFormat}, aspect_ratio=${aspectRatio}, and the weight rules to synthesize one final prompt. ` +
      `Honor dimension_guidance and each reference's directives: steer the result toward dimensions weighted above 1.0 and away from dimensions weighted below 1.0. ` +
      `Apply each reference's positive field as must-include content and its negative field as must-avoid content. ` +
      (characterAnchor?.subject_entities?.length
        ? `The current character anchor names this subject: ${characterAnchor.subject_entities.join(
            ", "
          )}. Preserve the exact named subject if character influence is high.\n\n`
        : "\n\n") +
      JSON.stringify(payload, null, 2),
    maxTokens: selectedFormat === "json" || selectedFormat === "ideogram_json" ? 1800 : 1200,
  });
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
  for (const r of curr) {
    const p = prevById.get(r.id);
    if (!p) continue;
    if (formatImageWeight(r.weight) !== formatImageWeight(p.weight)) weights++;
    if (
      formatDimensionWeights(r.dimensionWeights) !==
      formatDimensionWeights(p.dimensionWeights)
    )
      dims++;
    if ((r.positive || "") !== (p.positive || "") || (r.negative || "") !== (p.negative || ""))
      focus++;
  }
  if (weights) parts.push(`${weights} weight${weights > 1 ? "s" : ""} changed`);
  if (dims) parts.push(`${dims} dimension edit${dims > 1 ? "s" : ""}`);
  if (focus) parts.push(`${focus} focus edit${focus > 1 ? "s" : ""}`);
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
          <span className="text-rose-600">analysis failed</span>
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

function NoteItem({ item, onStartDrag, onDelete, onChange }) {
  return (
    <div
      style={{ left: item.x, top: item.y, zIndex: item.z || 1, width: 220 }}
      className="absolute select-none rounded-md border border-amber-300 bg-amber-50 shadow-sm"
    >
      <div
        onMouseDown={(e) => onStartDrag(e, item)}
        className="flex cursor-grab items-center gap-1 rounded-t-md bg-amber-100 px-2 py-1 text-[11px] text-amber-800 active:cursor-grabbing"
      >
        <StickyNote size={12} /> note
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onDelete(item.id)}
          className="ml-auto rounded p-0.5 text-amber-500 hover:bg-rose-50 hover:text-rose-600"
          title="Remove"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <textarea
        value={item.content}
        placeholder="Type or paste a writing sample…"
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange(item.id, e.target.value)}
        className="block h-28 w-full resize-none rounded-b-md bg-amber-50 p-2 text-[12px] leading-snug text-slate-800 outline-none"
      />
    </div>
  );
}

/* ---------------------------- app ------------------------------ */

export default function Mood() {
  const [initialState] = useState(loadPersistedState);
  const [boards, setBoards] = useState(initialState.boards);
  const [activeId, setActiveId] = useState(initialState.activeId);
  const [promptLibrary, setPromptLibrary] = useState(initialState.promptLibrary);

  // view transform
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [panning, setPanning] = useState(false);

  // ui state
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [toast, setToast] = useState("");
  const [showLibrary, setShowLibrary] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
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
  const zRef = useRef(10);
  const configRef = useRef(config);

  useEffect(() => void (boardsRef.current = boards), [boards]);
  useEffect(() => void (panRef.current = pan), [pan]);
  useEffect(() => void (scaleRef.current = scale), [scale]);
  useEffect(() => void (activeIdRef.current = activeId), [activeId]);
  useEffect(() => void (configRef.current = config), [config]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        savePersistedState({ boards, activeId, config, promptLibrary });
      } catch (e) {
        console.warn("mood could not save local state", e);
      }
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

  const activeBoard = boards.find((b) => b.id === activeId) || null;

  const flash = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2600);
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
    async (boardId, references, selectedFormat) => {
      const token = (genToken.current[boardId] || 0) + 1;
      genToken.current[boardId] = token;
      try {
        const prompt = await synthesizeImagePrompt(
          configRef.current,
          references,
          selectedFormat || DEFAULT_PROMPT_FORMAT
        );
        if (genToken.current[boardId] !== token) return;
        setOutput(boardId, "ready", prompt);
        recordHistory(
          boardId,
          prompt,
          selectedFormat || DEFAULT_PROMPT_FORMAT,
          references.map((r) => ({
            id: r.id,
            weight: r.weight,
            dimensionWeights: r.dimensionWeights,
            positive: r.positive || "",
            negative: r.negative || "",
          }))
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
        const sig =
          selectedFormat +
          "|" +
          ready
            .map(
              (r) =>
                `${r.id}:${formatImageWeight(r.weight)}:${formatDimensionWeights(
                  r.dimensionWeights
                )}:p${r.positive || ""}:n${r.negative || ""}`
            )
            .join("|");
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
          scheduleRegen(board.id, () =>
            runImageSynth(board.id, references, selectedFormat)
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
      lastSig.current[b.id] =
        selectedFormat +
        "|" +
        ready
          .map(
            (r) =>
              `${r.id}:${formatImageWeight(r.weight)}:${formatDimensionWeights(
                r.dimensionWeights
              )}:p${r.positive || ""}:n${r.negative || ""}`
          )
          .join("|");
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
        selectedFormat
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
          Distillation Studio
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
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
            >
              <Plus size={13} /> New
            </button>
          </div>
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
                <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
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
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-slate-100"
                >
                  <Upload size={13} /> Add images
                </button>
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
              <button onClick={resetView} className="rounded p-1 hover:bg-slate-100" title="Reset view">
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
                  onClick={() => setShowNew(true)}
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
                      />
                    ) : (
                      <NoteItem
                        key={item.id}
                        item={item}
                        onStartDrag={startItemDrag}
                        onDelete={(id) => removeItem(activeBoard.id, id)}
                        onChange={handleNoteChange}
                      />
                    )
                  )}
                </div>
              </>
            )}
          </div>

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
        />
      )}

      {showOnboarding && (
        <OnboardingModal
          onClose={dismissOnboarding}
          onCreate={() => {
            dismissOnboarding();
            setShowNew(true);
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
    body: "Weight each reference and dial in character, style, composition and lighting — then export as JSON, FLUX, Ideogram or Midjourney.",
  },
];

function OnboardingModal({ onClose, onCreate }) {
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
            Distillation Studio
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

function SettingsModal({
  config,
  setCfg,
  onClose,
  showKey,
  setShowKey,
  testConnection,
  testState,
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

          <div className="mb-4 grid grid-cols-2 gap-2">
            {Object.entries(PROVIDERS).map(([key, prov]) => (
              <button
                key={key}
                onClick={() => setCfg({ provider: key })}
                className={`flex items-center gap-2 rounded-md border p-2.5 text-left text-sm ${
                  p === key
                    ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200"
                    : "border-slate-300 hover:border-slate-400"
                }`}
              >
                <ProviderIcon name={prov.icon} className="shrink-0 text-indigo-500" />
                <span className="font-medium">{prov.label}</span>
              </button>
            ))}
          </div>

          {p === "anthropic" && (
            <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
              Uses the built-in Claude API — no key required. This is the only
              provider guaranteed to work inside the Claude.ai artifact preview.
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
            names, and prompt-library cards are saved in this browser's local
            storage. For production, proxy requests through a small backend
            instead of exposing keys client-side.
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
