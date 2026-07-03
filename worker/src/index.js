/* mood hosted-model proxy.
 *
 * Endpoints:
 *   POST /api/login    { password }                    → { token }
 *   POST /api/generate { system, text, images, maxTokens } → { text }
 *
 * Security model:
 * - GEMINI_API_KEY exists only as an encrypted Worker secret. It is used
 *   solely to call Google and never appears in any response, log, or error.
 * - Entry requires BETA_PASSWORD. A correct password yields an HMAC-signed
 *   token (30-day expiry) — the password itself is never stored client-side.
 * - Every generate call is rate-limited per token: burst (per minute) and
 *   daily caps, counted in KV. Payload size, image count, and output tokens
 *   are clamped server-side; the model id is pinned server-side.
 */

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_IMAGES = 12;
const MAX_BODY_BYTES = 24 * 1024 * 1024; // generous for base64 images
const MAX_OUTPUT_TOKENS = 4096;
const MAX_TEXT_CHARS = 200_000;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (cors === null) {
      return json({ error: "Origin not allowed" }, 403, {});
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/login" && request.method === "POST") {
        return await login(request, env, cors);
      }
      if (url.pathname === "/api/generate" && request.method === "POST") {
        return await generate(request, env, cors);
      }
      return json({ error: "Not found" }, 404, cors);
    } catch (e) {
      // Never echo internal error details (they could reference upstream
      // request internals); log server-side only.
      console.error("mood-proxy error:", e);
      return json({ error: "Internal error" }, 500, cors);
    }
  },
};

/* ------------------------------ auth ------------------------------ */

async function login(request, env, cors) {
  const { password } = await request.json().catch(() => ({}));
  if (typeof password !== "string") {
    return json({ error: "Wrong password" }, 401, cors);
  }

  // Owner password: token uid carries an "admin-" prefix (covered by the
  // HMAC signature, so it can't be forged) and skips every rate limit and
  // the redemption cap.
  if (
    env.ADMIN_PASSWORD &&
    (await constantTimeEqual(password, env.ADMIN_PASSWORD))
  ) {
    const uid = `admin-${crypto.randomUUID()}`;
    const exp = Date.now() + TOKEN_TTL_MS;
    const sig = await hmac(env.TOKEN_SECRET, `${uid}.${exp}`);
    return json({ token: `${uid}.${exp}.${sig}` }, 200, cors);
  }

  if (!(await constantTimeEqual(password, env.BETA_PASSWORD))) {
    return json({ error: "Wrong password" }, 401, cors);
  }
  // Cap how many times this password can be redeemed. The counter key is
  // derived from the password itself, so rotating the password starts a
  // fresh count. Existing tokens keep working after the cap is hit.
  const maxUses = Number(env.LIMIT_PASSWORD_USES || 25);
  const usesKey = `pw:${(await hmac(env.TOKEN_SECRET, env.BETA_PASSWORD)).slice(0, 16)}`;
  const uses = Number((await env.RATE.get(usesKey)) || 0);
  if (uses >= maxUses) {
    return json(
      { error: "The beta is full — this password has reached its invite limit." },
      403,
      cors
    );
  }
  await env.RATE.put(usesKey, String(uses + 1));
  const uid = crypto.randomUUID();
  const exp = Date.now() + TOKEN_TTL_MS;
  const sig = await hmac(env.TOKEN_SECRET, `${uid}.${exp}`);
  return json({ token: `${uid}.${exp}.${sig}` }, 200, cors);
}

async function verifyToken(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const [uid, expStr, sig] = token.split(".");
  if (!uid || !expStr || !sig) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = await hmac(env.TOKEN_SECRET, `${uid}.${exp}`);
  if (!(await constantTimeEqual(sig, expected))) return null;
  return uid;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Compare via digests so length differences and mismatches take equal time.
async function constantTimeEqual(a, b) {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b))),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/* --------------------------- rate limits -------------------------- */

async function checkRateLimit(env, uid) {
  // Owner tokens are exempt from all limits and don't count toward the
  // global cap.
  if (uid.startsWith("admin-")) return { ok: true };
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const minuteKey = `m:${uid}:${Math.floor(now.getTime() / 60000)}`;
  const dayKey = `d:${uid}:${day}`;
  const globalKey = `g:${day}`;
  const [minuteRaw, dayRaw, globalRaw] = await Promise.all([
    env.RATE.get(minuteKey),
    env.RATE.get(dayKey),
    env.RATE.get(globalKey),
  ]);
  const minuteCount = Number(minuteRaw || 0);
  const dayCount = Number(dayRaw || 0);
  const globalCount = Number(globalRaw || 0);
  if (minuteCount >= Number(env.LIMIT_PER_MINUTE || 10)) {
    return { ok: false, error: "Rate limit: too many requests — wait a minute." };
  }
  if (dayCount >= Number(env.LIMIT_PER_DAY || 150)) {
    return { ok: false, error: "Daily limit reached — resets at midnight UTC." };
  }
  // Spend ceiling across ALL users, whatever the per-user math adds up to.
  if (globalCount >= Number(env.LIMIT_GLOBAL_PER_DAY || 1000)) {
    return {
      ok: false,
      error: "The beta hit today's overall usage cap — back tomorrow.",
    };
  }
  await Promise.all([
    env.RATE.put(minuteKey, String(minuteCount + 1), { expirationTtl: 120 }),
    env.RATE.put(dayKey, String(dayCount + 1), { expirationTtl: 60 * 60 * 48 }),
    env.RATE.put(globalKey, String(globalCount + 1), {
      expirationTtl: 60 * 60 * 48,
    }),
  ]);
  return { ok: true };
}

/* ----------------------------- generate --------------------------- */

async function generate(request, env, cors) {
  const uid = await verifyToken(request, env);
  if (!uid) {
    return json({ error: "Invalid or expired session" }, 401, cors);
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: "Request too large" }, 413, cors);
  }

  const limit = await checkRateLimit(env, uid);
  if (!limit.ok) {
    return json({ error: limit.error }, 429, cors);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.text !== "string") {
    return json({ error: "Bad request" }, 400, cors);
  }
  const system = typeof body.system === "string" ? body.system : "";
  const text = body.text.slice(0, MAX_TEXT_CHARS);
  const images = Array.isArray(body.images)
    ? body.images.slice(0, MAX_IMAGES)
    : [];
  const maxTokens = Math.min(
    Math.max(Number(body.maxTokens) || 1024, 1),
    MAX_OUTPUT_TOKENS
  );

  const parts = [{ text }];
  for (const dataUrl of images) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl));
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }

  const payload = {
    contents: [{ role: "user", parts }],
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };

  const model = env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  // Gemini intermittently returns 429/500/503 under load; these usually
  // clear within a second, so absorb them with a couple of retries instead
  // of surfacing every blip to the user.
  let upstream;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Key travels only in this server-to-server header, never in a URL
          // (URLs can end up in logs) and never back to the client.
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
        body: JSON.stringify(payload),
      }
    );
    if (upstream.ok || ![429, 500, 503].includes(upstream.status)) break;
    console.error("gemini retryable", upstream.status, `attempt ${attempt + 1}`);
  }

  if (!upstream.ok) {
    // Surface the status but not the upstream body — it can contain
    // request echoes we don't want to hand to clients.
    console.error("gemini upstream", upstream.status, await upstream.text());
    return json(
      {
        error: `The model is briefly overloaded (${upstream.status}) — try again in a few seconds.`,
      },
      502,
      cors
    );
  }

  const data = await upstream.json();
  const out = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n")
    .trim();
  return json({ text: out }, 200, cors);
}

/* ------------------------------ http ------------------------------ */

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return {}; // non-browser client (curl, server) — no CORS needed
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
