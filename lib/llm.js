// Free AI providers: Google Gemini (main) and Groq (backup).
//
// Free-tier limits that shape this file:
//   Gemini - 20 requests per day PER MODEL, but generous output per request.
//            Two models are tried so the daily allowance is doubled.
//   Groq   - ~1000 requests per day, but only 1000 output tokens per minute,
//            so it is only usable for short answers.
// messages = [{ role: "user" | "assistant", content: "..." }]

export class LLMError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

const hasGemini = () => !!process.env.GEMINI_API_KEY;
const hasGroq = () => !!process.env.GROQ_API_KEY;
const GEMINI_DEFAULT = "gemini-3.1-flash-lite";
const GEMINI_ALT = "gemini-3.8-flash";       // its own separate daily quota
const geminiModel = () => process.env.GEMINI_MODEL || GEMINI_DEFAULT;
const GROQ_DEFAULT = "qwen/qwen3.8-27b";
const GROQ_MAX_OUT = 900;                    // free tier rejects anything over ~1000
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
const geminiUrl = (model, action) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}`;

// Free Flash models return 503 "high demand" fairly often, and Google retires
// model names without warning. Retry once on either, then give up so the other
// provider gets its turn.
// opts.retries: how many times to wait out a busy model before giving up.
// Live requests want 1 (fail fast, fall back to Groq); batch authoring wants
// several, because nobody is waiting and a retry is cheaper than a lost job.
const GEMINI_BUSY = new Set([500, 502, 503]);
async function geminiFetch(action, messages, opts, query = "") {
  const maxRetries = opts.retries ?? 1;
  const tried = new Set();
  let model = geminiModel(), waits = 0;
  for (;;) {
    tried.add(model);
    const r = await fetch(geminiUrl(model, action) + query, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify(geminiBody(messages, opts))
    });
    if (r.ok) return r;

    // A retired model name, or one whose daily quota is spent, should not end
    // the attempt while another free model is still untried.
    if (r.status === 404 || r.status === 429) {
      const next = [GEMINI_DEFAULT, GEMINI_ALT].find(m => !tried.has(m));
      if (!next) return r;
      console.warn("Gemini", model, r.status === 404 ? "is gone" : "quota spent", "- trying", next);
      model = next;
      continue;
    }

    if (!GEMINI_BUSY.has(r.status) || waits >= maxRetries) return r;
    const pause = 1500 * 2 ** waits;
    waits++;
    console.warn(`Gemini ${r.status} - waiting ${pause}ms (retry ${waits}/${maxRetries})`);
    await new Promise(s => setTimeout(s, pause));
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
  const body = { model, messages, temperature, max_tokens: Math.min(maxTokens, GROQ_MAX_OUT), stream };
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

// Gemini first (better answers, longer output), Groq as the safety net.
// opts.only pins one provider: authoring uses it to refuse Groq, whose free
// tier truncates at ~900 output tokens, which would store a half-written
// lesson permanently.
function providers(only) {
  const list = [];
  if (hasGemini()) list.push(["Gemini", geminiComplete, geminiStream]);
  if (hasGroq()) list.push(["Groq", groqComplete, groqStream]);
  return only ? list.filter(p => p[0] === only) : list;
}

export async function complete(messages, opts = {}) {
  const list = providers(opts.only);
  if (!list.length) throw new LLMError("no_key", "No AI key is set (GROQ_API_KEY or GEMINI_API_KEY)");
  let last;
  for (const [name, fn] of list) {
    try { return await fn(messages, opts); }
    catch (e) { last = e; console.warn(name, "failed:", e.message); }
  }
  throw last;
}

export async function* stream(messages, opts = {}) {
  const list = providers(opts.only);
  if (!list.length) throw new LLMError("no_key", "No AI key is set (GROQ_API_KEY or GEMINI_API_KEY)");
  let last;
  for (const [name, , fn] of list) {
    let started = false;
    try {
      for await (const t of fn(messages, opts)) { started = true; yield t; }
      return;
    } catch (e) {
      // Once text has reached the browser we cannot restart with another provider.
      if (started) throw e;
      last = e;
      console.warn(name, "stream failed:", e.message);
    }
  }
  throw last;
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
