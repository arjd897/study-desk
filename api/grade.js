import { admin, requireUser, send, body } from "../lib/server.js";
import { completeJSON } from "../lib/llm.js";
import { questionPrompt, gradePrompt, codeGradePrompt, nextReview, KINDS } from "../lib/grading.js";

// Assessment endpoint. Two actions:
//   { action: "ask",   concept_id, level }                  -> a question
//   { action: "grade", concept_id, level, question, expects, answer }
//
// Mastery is written here with the service key, never by the browser, so
// progress reflects work that was actually marked.

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { message: "Use POST." });
  const user = await requireUser(req);
  if (!user) return send(res, 401, { message: "Please sign in again." });

  const sb = admin();
  const b = body(req);
  const conceptId = String(b.concept_id || "").slice(0, 80);
  const level = Math.max(0, Math.min(5, Number(b.level) || 0));
  if (!conceptId) return send(res, 400, { message: "Which concept?" });

  // Asking costs a request too, so it counts against the daily allowance.
  const limit = Number(process.env.DAILY_AI_LIMIT || 120);
  const { data: allowed } = await sb.rpc("bump_usage", { uid: user.id, lim: limit });
  if (allowed === false) return send(res, 429, { message: `You have used today's ${limit} AI requests. It resets tomorrow.` });

  const { data: concept } = await sb.from("concepts").select("id, title, blurb, area").eq("id", conceptId).maybeSingle();
  if (!concept) return send(res, 404, { message: "Unknown concept." });

  const { data: lv } = await sb.from("concept_levels")
    .select("body, exercise").eq("concept_id", conceptId).eq("level", level).maybeSingle();
  if (!lv) return send(res, 404, { message: "This level has not been written yet. It is still being prepared." });

  try {
    if (b.action === "ask") return await ask(res, sb, user, concept, level, lv);
    if (b.action === "grade") return await grade(res, sb, user, concept, level, lv, b);
    return send(res, 400, { message: "Unknown action." });
  } catch (e) {
    console.error("grade", conceptId, level, e.code, e.message);
    const busy = e.code === "rate_limited";
    return send(res, busy ? 429 : 502, {
      message: busy ? "The free AI quota is busy right now. Wait a minute and try again."
                    : "Marking failed. Your answer was not lost, try again."
    });
  }
}

async function ask(res, sb, user, concept, level, lv) {
  if (level === 3) {
    const ex = lv.exercise;
    if (!ex) return send(res, 404, { message: "No exercise for this level yet." });
    return send(res, 200, { kind: "code", question: ex.brief, rubric: ex.rubric });
  }

  // Do not ask the same question twice.
  const { data: past } = await sb.from("attempts").select("question")
    .eq("user_id", user.id).eq("concept_id", concept.id).eq("level", level)
    .order("created_at", { ascending: false }).limit(4);

  const d = await completeJSON([{ role: "user", content:
    questionPrompt(concept, level, lv.body, (past || []).map(p => p.question)) }], { temperature: 0.8 });

  const expects = (Array.isArray(d.expects) ? d.expects : []).map(String).filter(Boolean).slice(0, 6);
  if (!d.question || expects.length < 2) return send(res, 502, { message: "Could not set a question. Try again." });
  return send(res, 200, { kind: KINDS[level], question: String(d.question), expects });
}

async function grade(res, sb, user, concept, level, lv, b) {
  const answer = String(b.answer || "").trim();
  if (answer.length < 10) return send(res, 400, { message: "Write a real answer first." });

  let d, question;
  if (level === 3) {
    const ex = lv.exercise;
    if (!ex) return send(res, 404, { message: "No exercise for this level yet." });
    question = ex.brief;
    d = await completeJSON([{ role: "user", content:
      codeGradePrompt(concept, ex.brief, ex.reference, ex.rubric || [], answer) }], { temperature: 0.2, maxTokens: 3000 });
  } else {
    question = String(b.question || "");
    const expects = (Array.isArray(b.expects) ? b.expects : []).map(String).slice(0, 6);
    if (!question || !expects.length) return send(res, 400, { message: "Ask for a question first." });
    d = await completeJSON([{ role: "user", content:
      gradePrompt(concept, level, question, expects, answer) }], { temperature: 0.2, maxTokens: 3000 });
  }

  const score = Math.max(0, Math.min(1, Number(d.score) || 0));
  const passed = d.verdict === "pass" && score >= 0.7;

  await sb.from("attempts").insert({
    user_id: user.id, concept_id: concept.id, level,
    kind: level === 3 ? "code" : KINDS[level],
    question: question.slice(0, 4000), response: answer.slice(0, 8000),
    score, feedback: String(d.feedback || "").slice(0, 4000)
  });

  // Mastery only ever moves forward on a pass, and the review clock resets on
  // a miss so weak material comes back sooner.
  const { data: cur } = await sb.from("mastery").select("level, score, streak")
    .eq("user_id", user.id).eq("concept_id", concept.id).maybeSingle();
  const held = cur ? cur.level : -1;
  const { streak, due_at } = nextReview(cur ? cur.streak : 0, passed);

  await sb.from("mastery").upsert({
    user_id: user.id, concept_id: concept.id,
    level: passed ? Math.max(held, level) : Math.max(held, -1),
    score, streak, due_at, updated_at: new Date().toISOString()
  });

  return send(res, 200, {
    score, passed,
    feedback: String(d.feedback || ""),
    hits: d.hits || (d.rubric_results || []).filter(r => r.met).map(r => r.item),
    misses: d.misses || (d.rubric_results || []).filter(r => !r.met).map(r => r.item),
    bug: String(d.bug || ""),
    rubric_results: d.rubric_results || null,
    unlocked: passed && level > held
  });
}
