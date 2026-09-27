// Free AI providers: Google Gemini (main) and Groq (optional backup).
// messages = [{ role: "user" | "assistant", content: "..." }]

export class LLMError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

const hasGemini = () => !!process.env.GEMINI_API_KEY;
const hasGroq = () => !!process.env.GROQ_API_KEY;
const geminiModel = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";
const GROQ_DEFAULT = "qwen/qwen3.8-27b";
const groqModel = () => process.env.GROQ_MODEL || GROQ_DEFAULT;

function errFrom(provider, status, text) {
  return new LLMError(status === 429 ? "rate_limited" : "upstream", `${provider} ${status}: ${String(text).slice(0, 300)}`, status);
}

/* ---------------- Gemini ---------------- */
function geminiBody(messages, { json, maxTokens = 8192, temperature = 0.7 }) {
  const body = {
    contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig: { temperature, maxOutputTokens: maxTokens }
  };
  if (json) body.generationConfig.responseMimeType = "application/json";
  return body;
}
const geminiUrl = (action) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:${action}`;

// Free Flash models return 503 "high demand" fairly often. That clears in a
// second or two, so retry once before giving up on Gemini entirely.
const GEMINI_BUSY = new Set([500, 502, 503]);
async function geminiFetch(action, messages, opts, query = "") {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(geminiUrl(action) + query, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify(geminiBody(messages, opts))
    });
    if (r.ok || attempt >= 1 || !GEMINI_BUSY.has(r.status)) return r;
    console.warn("Gemini", r.status, "- retrying once");
    await new Promise(s => setTimeout(s, 1500));
  }
}

async function geminiComplete(messages, opts) {
  if (!hasGemini()) throw new LLMError("no_key", "GEMINI_API_KEY is missing");
  const r = await geminiFetch("generateContent", messages, opts);
  if (!r.ok) throw errFrom("Gemini", r.status, await r.text());
  const d = await r.json();
  const text = (d.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
  if (!text.trim()) throw new LLMError("empty", "Gemini returned no text");
  return text;
}

async function* geminiStream(messages, opts) {
  if (!hasGemini()) throw new LLMError("no_key", "GEMINI_API_KEY is missing");
  const r = await geminiFetch("streamGenerateContent", messages, opts, "?alt=sse");
  if (!r.ok) throw errFrom("Gemini", r.status, await r.text());
  yield* sseLines(r, (d) => (d.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join(""));
}

/* ---------------- Groq (OpenAI-compatible) ---------------- */
function groqBody(messages, { json, maxTokens = 8192, temperature = 0.7 }, stream, model) {
  const body = { model, messages, temperature, max_tokens: Math.min(maxTokens, 8000), stream };
  if (json) body.response_format = { type: "json_object" };
  return body;
}

// Groq retires model names without warning. If the configured one is gone,
// fall back to the built-in default rather than losing the backup provider.
async function groqFetch(messages, opts, stream) {
  let model = groqModel();
  for (let attempt = 0; ; attempt++) {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + process.env.GROQ_API_KEY },
      body: JSON.stringify(groqBody(messages, opts, stream, model))
    });
    if (r.status !== 404 || attempt >= 1 || model === GROQ_DEFAULT) return r;
    console.warn("Groq model", model, "no longer exists, using", GROQ_DEFAULT);
    model = GROQ_DEFAULT;
  }
}

async function groqComplete(messages, opts) {
  const r = await groqFetch(messages, opts, false);
  if (!r.ok) throw errFrom("Groq", r.status, await r.text());
  const d = await r.json();
  const text = d.choices?.[0]?.message?.content || "";
  if (!text.trim()) throw new LLMError("empty", "Groq returned no text");
  return text;
}
async function* groqStream(messages, opts) {
  const r = await groqFetch(messages, opts, true);
  if (!r.ok) throw errFrom("Groq", r.status, await r.text());
  yield* sseLines(r, (d) => d.choices?.[0]?.delta?.content || "");
}

/* ---------------- shared ---------------- */
async function* sseLines(response, pick) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try { const t = pick(JSON.parse(data)); if (t) yield t; } catch { /* ignore partial line */ }
    }
  }
}

export async function complete(messages, opts = {}) {
  try {
    return await geminiComplete(messages, opts);
  } catch (e) {
    if (hasGroq()) { console.warn("Gemini failed, using Groq:", e.message); return await groqComplete(messages, opts); }
    throw e;
  }
}

export async function* stream(messages, opts = {}) {
  let started = false;
  try {
    for await (const t of geminiStream(messages, opts)) { started = true; yield t; }
    return;
  } catch (e) {
    if (started || !hasGroq()) throw e;
    console.warn("Gemini stream failed, using Groq:", e.message);
  }
  yield* groqStream(messages, opts);
}

export function parseJSON(text) {
  let t = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch { /* try to cut out the object */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  throw new LLMError("invalid_json", "AI reply was not valid JSON");
}

export async function completeJSON(messages, opts = {}) {
  return parseJSON(await complete(messages, { ...opts, json: true }));
}
