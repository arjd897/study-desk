import { admin, requireUser, send, body } from "../lib/server.js";
import * as P from "../lib/prompts.js";
import { completeJSON, stream } from "../lib/llm.js";

// One endpoint for every AI feature. The browser sends { task, ... }.
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { message: "Use POST." });

  const user = await requireUser(req);
  if (!user) return send(res, 401, { message: "Please sign in again." });

  // Per-person daily limit, so friends you share the app with can't use up your free AI quota.
  const limit = Number(process.env.DAILY_AI_LIMIT || 120);
  const { data: allowed, error: usageErr } = await admin().rpc("bump_usage", { uid: user.id, lim: limit });
  if (usageErr) console.error("usage check failed", usageErr.message);
  else if (allowed === false) {
    return send(res, 429, { message: `You've used today's ${limit} AI requests. It resets tomorrow.` });
  }

  const b = body(req);
  const task = String(b.task || "");
  const profile = String(b.profile || "").slice(0, 4000);
  const item = b.item ? P.normItem(b.item) : null;
  const lesson = String(b.lesson || "").slice(0, 9000);

  try {
    switch (task) {
      case "recs": {
        const d = await completeJSON([{ role: "user", content: P.recsPrompt(profile, P.today(), Array.isArray(b.papers) ? b.papers : []) }]);
        const items = (Array.isArray(d.items) ? d.items : []).slice(0, 8).map(P.normItem);
        if (!items.length) throw Object.assign(new Error("no items"), { code: "invalid_json" });
        return send(res, 200, { focus: String(d.focus || ""), items });
      }
      case "path": {
        const topic = String(b.topic || "").trim().slice(0, 140);
        if (!topic) return send(res, 400, { message: "Type a topic first." });
        const d = await completeJSON([{ role: "user", content: P.pathPrompt(profile, topic) }]);
        const steps = (Array.isArray(d.steps) ? d.steps : []).slice(0, 12).map(P.normItem);
        if (!steps.length) throw Object.assign(new Error("no steps"), { code: "invalid_json" });
        return send(res, 200, { topic: String(d.topic || topic).slice(0, 120), overview: String(d.overview || ""), steps });
      }
      case "quiz": {
        if (!item || !lesson) return send(res, 400, { message: "Open a lesson first." });
        const d = await completeJSON([{ role: "user", content: P.quizPrompt(item, lesson) }], { temperature: 0.9 });
        const questions = (Array.isArray(d.questions) ? d.questions : [])
          .filter(q => q && q.q && Array.isArray(q.options) && q.options.length >= 2)
          .slice(0, 6)
          .map(q => ({ q: String(q.q), options: q.options.slice(0, 5).map(String), answer: Number(q.answer) || 0, why: String(q.why || "") }));
        if (!questions.length) throw Object.assign(new Error("no questions"), { code: "invalid_json" });
        return send(res, 200, { questions });
      }
      case "terms": {
        if (!item || !lesson) return send(res, 400, { message: "Open a lesson first." });
        const d = await completeJSON([{ role: "user", content: P.termsPrompt(item, lesson) }], { temperature: 0.3 });
        const terms = (Array.isArray(d.terms) ? d.terms : []).filter(t => t && t.term).slice(0, 10)
          .map(t => ({ term: String(t.term).slice(0, 80), meaning: String(t.meaning || ""), example: String(t.example || "") }));
        return send(res, 200, { terms });
      }
      case "explain": {
        if (!item) return send(res, 400, { message: "Missing topic." });
        return streamOut(res, [{ role: "user", content: P.explainPrompt(profile, item, !!b.fresh) }], { temperature: b.fresh ? 0.95 : 0.7 });
      }
      case "chat": {
        let turns = (Array.isArray(b.turns) ? b.turns : []).slice(-12)
          .filter(t => t && t.content)
          .map(t => ({ role: t.role === "assistant" ? "assistant" : "user", content: String(t.content).slice(0, 4000) }));
        while (turns.length && turns[0].role !== "user") turns.shift();
        if (!turns.length) return send(res, 400, { message: "Type a question first." });
        const messages = [
          { role: "user", content: P.chatRules(profile, item, lesson) },
          { role: "assistant", content: "Understood. Ask me anything about this lesson." },
          ...turns
        ];
        return streamOut(res, messages, { maxTokens: 2048 });
      }
      default:
        return send(res, 400, { message: "Unknown task." });
    }
  } catch (e) {
    console.error(task, e.code, e.message);
    const busy = e.code === "rate_limited";
    return send(res, busy ? 429 : 502, {
      message: busy
        ? "The free AI quota is busy right now. Wait a minute and try again."
        : e.code === "no_key"
          ? "No AI key is set on the server. Add GEMINI_API_KEY in Vercel settings."
          : "The AI service had a problem. Try again."
    });
  }
}

// Sends the lesson text to the browser piece by piece as it is written.
async function streamOut(res, messages, opts) {
  let started = false;
  try {
    for await (const chunk of stream(messages, opts)) {
      if (!started) {
        started = true;
        res.statusCode = 200;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.setHeader("cache-control", "no-cache, no-transform");
        res.setHeader("x-accel-buffering", "no");
      }
      res.write(chunk);
    }
    if (!started) return send(res, 502, { message: "No answer came back. Try again." });
    res.end();
  } catch (e) {
    console.error("stream", e.code, e.message);
    if (!started) {
      return send(res, e.code === "rate_limited" ? 429 : 502, {
        message: e.code === "rate_limited" ? "The free AI quota is busy right now. Wait a minute and try again." : "The AI service had a problem. Try again."
      });
    }
    res.write("\n\n[[ERROR]]");
    res.end();
  }
}
