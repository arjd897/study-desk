// Fills in the shared knowledge base, a few levels per run.
//
//   node --env-file=.env scripts/author.mjs            # default budget
//   node --env-file=.env scripts/author.mjs --budget 3 # fewer AI calls
//   node --env-file=.env scripts/author.mjs --concept kv-cache --level 2
//
// Written content is shared by every learner, so this runs slowly in the
// background rather than while somebody waits. It stops cleanly when the
// free quota runs out and picks up where it left off next time.

import { admin } from "../lib/server.js";
import { complete, completeJSON, LLMError } from "../lib/llm.js";
import { levelPrompt, selectSources } from "../lib/authoring.js";

const sb = admin();
const arg = (name, def) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const BUDGET = Number(arg("budget", process.env.AUTHOR_BUDGET || 6));
const GAP = Number(process.env.LLM_GAP_MS || 7000);
const ONLY_CONCEPT = arg("concept", null);
const ONLY_LEVEL = arg("level", null);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------------- what still needs writing ---------------- */

async function plan() {
  const { data: concepts, error } = await sb.from("concepts").select("*").order("sort");
  if (error) throw new Error("concepts: " + error.message);
  if (!concepts.length) throw new Error("No concepts. Run scripts/ingest.mjs first.");

  const { data: edges } = await sb.from("concept_edges").select("*");
  const { data: have } = await sb.from("concept_levels").select("concept_id, level");
  const done = new Set((have || []).map(r => `${r.concept_id}:${r.level}`));

  const prereqs = new Map(concepts.map(c => [c.id, []]));
  for (const e of edges || []) prereqs.get(e.concept_id)?.push(e.requires_id);
  const titleOf = new Map(concepts.map(c => [c.id, c.title]));

  // Depth-first per concept, concepts in learning order: a learner reaching
  // concept 3 should find all its levels ready before concept 12 has any.
  const todo = [];
  for (const c of concepts) {
    if (ONLY_CONCEPT && c.id !== ONLY_CONCEPT) continue;
    for (let lv = 0; lv <= c.max_level; lv++) {
      if (ONLY_LEVEL != null && lv !== Number(ONLY_LEVEL)) continue;
      if (done.has(`${c.id}:${lv}`)) continue;
      todo.push({ concept: c, level: lv, prereqTitles: (prereqs.get(c.id) || []).map(id => titleOf.get(id) || id) });
    }
  }
  return { todo, total: concepts.reduce((n, c) => n + c.max_level + 1, 0), done: done.size };
}

/* ---------------- grounding ---------------- */

async function sourcesFor(conceptId) {
  const { data: links } = await sb.from("concept_papers").select("arxiv_id, role, note").eq("concept_id", conceptId);
  if (!links || !links.length) return [];
  const ids = links.map(l => l.arxiv_id);
  const { data: papers } = await sb.from("corpus_papers").select("arxiv_id, title, abstract, sections").in("arxiv_id", ids);
  const byId = new Map((papers || []).map(p => [p.arxiv_id, p]));
  const merged = links
    .sort((a, b) => (a.role === "canonical" ? -1 : 1) - (b.role === "canonical" ? -1 : 1))
    .map(l => ({ ...(byId.get(l.arxiv_id) || { arxiv_id: l.arxiv_id, sections: [] }), note: l.note }))
    .filter(p => p.sections || p.abstract);
  return selectSources(merged);
}

/* ---------------- writing one level ---------------- */

// Stored content is permanent and shared, so refuse anything that stopped
// mid-thought rather than saving a half-written lesson for everyone.
function assertComplete(body) {
  const t = body.trim();
  if (t.length < 400) throw new LLMError("empty", `only ${t.length} chars came back`);
  if (!/[.!?:)"'`\]}]$/.test(t) && !t.endsWith("```")) {
    throw new LLMError("truncated", `ends mid-sentence: ...${t.slice(-60)}`);
  }
  const opened = (t.match(/```/g) || []).length;
  if (opened % 2) throw new LLMError("truncated", "unclosed code fence");
  return t;
}

async function write({ concept, level, prereqTitles }) {
  const sources = level === 0 || level === 5 ? [] : await sourcesFor(concept.id);
  const prompt = levelPrompt(level, concept, prereqTitles, sources);
  const cite = sources.map(s => ({ arxiv_id: s.arxiv_id, section: s.heading }));

  if (level === 3) {
    const d = await completeJSON([{ role: "user", content: prompt }], { temperature: 0.4, maxTokens: 4096, only: "Gemini" });
    const rubric = Array.isArray(d.rubric) ? d.rubric.map(String).filter(Boolean) : [];
    if (!d.brief || !d.reference || rubric.length < 3) throw new LLMError("invalid_json", "exercise missing brief, reference or rubric");
    return {
      body: String(d.brief),
      exercise: { brief: String(d.brief), reference: String(d.reference), rubric },
      sources: cite
    };
  }

  const body = await complete([{ role: "user", content: prompt }], { temperature: 0.5, maxTokens: 4096, only: "Gemini" });
  return { body: assertComplete(body), exercise: null, sources: cite };
}

/* ---------------- run ---------------- */

const { todo, total, done } = await plan();
console.log(`knowledge base: ${done}/${total} levels written, ${todo.length} outstanding`);
if (!todo.length) { console.log("nothing to do."); process.exit(0); }

let wrote = 0, failed = 0;
for (const job of todo.slice(0, BUDGET)) {
  const label = `${job.concept.id} L${job.level}`;
  try {
    const out = await write(job);
    const { error } = await sb.from("concept_levels").upsert({
      concept_id: job.concept.id, level: job.level,
      body: out.body, sources: out.sources, exercise: out.exercise,
      model: process.env.GEMINI_MODEL || ""
    });
    if (error) throw new Error(error.message);
    wrote++;
    console.log(`  ${label.padEnd(30)} ok   ${out.body.length} chars, ${out.sources.length} sources cited`);
  } catch (e) {
    failed++;
    console.warn(`  ${label.padEnd(30)} FAIL ${e.code || ""} ${String(e.message).slice(0, 120)}`);
    // Out of Gemini quota for today: stop rather than burn the rest of the run
    // failing. Nothing was saved, so the next run retries this same job.
    if (e.code === "rate_limited" || e.code === "no_key") { console.warn("  Gemini quota spent, stopping until tomorrow"); break; }
  }
  await sleep(GAP);
}

console.log(`\nwrote ${wrote}, failed ${failed}. ${done + wrote}/${total} levels now complete.`);
