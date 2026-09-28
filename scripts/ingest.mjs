// Loads the curriculum graph into the database and fetches the real text of
// every paper it references. Run it whenever curriculum/*.json changes.
//
//   node --env-file=.env scripts/ingest.mjs
//
// Uses no AI quota at all: this is fetching and parsing, nothing else.

import fs from "node:fs";
import path from "node:path";
import { admin } from "../lib/server.js";

const sb = admin();
const DIR = new URL("../curriculum/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------------- curriculum ---------------- */

async function loadTrack(file) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));

  const ids = new Set(d.concepts.map(c => c.id));
  for (const c of d.concepts) {
    for (const r of c.requires || []) if (!ids.has(r)) throw new Error(`${c.id} requires unknown concept ${r}`);
    for (const p of c.papers || []) if (!d.papers[p.id]) throw new Error(`${c.id} cites unlisted paper ${p.id}`);
  }
  orderCheck(d.concepts);

  const concepts = d.concepts.map((c, i) => ({
    id: c.id, title: c.title, blurb: c.blurb || "", area: c.area,
    track: d.track, sort: i, max_level: c.max_level ?? 5
  }));
  let r = await sb.from("concepts").upsert(concepts);
  if (r.error) throw new Error("concepts: " + r.error.message);

  const edges = d.concepts.flatMap(c => (c.requires || []).map(x => ({ concept_id: c.id, requires_id: x })));
  r = await sb.from("concept_edges").upsert(edges);
  if (r.error) throw new Error("edges: " + r.error.message);

  const links = d.concepts.flatMap(c => (c.papers || []).map(p => ({
    concept_id: c.id, arxiv_id: p.id, role: p.role || "canonical", note: p.note || ""
  })));
  if (links.length) {
    r = await sb.from("concept_papers").upsert(links);
    if (r.error) throw new Error("concept_papers: " + r.error.message);
  }

  console.log(`${d.track}: ${concepts.length} concepts, ${edges.length} prerequisites, ${links.length} paper links`);
  return Object.keys(d.papers);
}

// A prerequisite graph with a cycle would deadlock the scheduler, so refuse it here.
function orderCheck(concepts) {
  const need = new Map(concepts.map(c => [c.id, new Set(c.requires || [])]));
  const done = new Set();
  for (let pass = 0; pass < concepts.length + 1; pass++) {
    let moved = false;
    for (const [id, reqs] of need) {
      if (done.has(id)) continue;
      if ([...reqs].every(r => done.has(r))) { done.add(id); moved = true; }
    }
    if (!moved) break;
  }
  if (done.size !== concepts.length) {
    throw new Error("prerequisite cycle involving: " + concepts.map(c => c.id).filter(id => !done.has(id)).join(", "));
  }
}

/* ---------------- papers ---------------- */

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
};
const unescapeXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function fetchMeta(id) {
  const r = await fetch(`http://export.arxiv.org/api/query?id_list=${id}`, { headers: { accept: "application/atom+xml" } });
  if (!r.ok) throw new Error("arXiv API " + r.status);
  const xml = await r.text();
  const entry = xml.slice(xml.indexOf("<entry>"), xml.lastIndexOf("</entry>") + 8);
  if (!entry) throw new Error("no entry returned");
  const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map(m => m[1].trim());
  return {
    title: unescapeXml(tag(entry, "title")),
    abstract: unescapeXml(tag(entry, "summary")),
    authors: authors.slice(0, 6).join(", ") + (authors.length > 6 ? " et al." : ""),
    published: (tag(entry, "published") || "").slice(0, 10) || null
  };
}

// arXiv renders recent papers to HTML. When it exists we get real section text;
// when it does not we fall back to the abstract and mark the row accordingly.
async function fetchSections(id) {
  for (const url of [`https://arxiv.org/html/${id}v1`, `https://arxiv.org/html/${id}`]) {
    try {
      const r = await fetch(url, { redirect: "follow" });
      if (!r.ok) continue;
      const html = await r.text();
      if (!/<section|<h2/i.test(html)) continue;
      const sections = parseSections(html);
      if (sections.length >= 2) return sections;
    } catch { /* try the next url */ }
  }
  return [];
}

function parseSections(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<figure[\s\S]*?<\/figure>/gi, " ");
  const out = [];
  const re = /<h([2-3])[^>]*>([\s\S]*?)<\/h\1>([\s\S]*?)(?=<h[2-3][^>]*>|$)/gi;
  let m;
  while ((m = re.exec(body))) {
    const heading = strip(m[2]);
    const text = strip(m[3]);
    if (heading && text.length > 200) out.push({ heading: heading.slice(0, 200), text: text.slice(0, 20000) });
  }
  return out.slice(0, 30);
}
const strip = (s) => unescapeXml(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function ingestPaper(id) {
  const { data: have } = await sb.from("corpus_papers").select("arxiv_id, full_text").eq("arxiv_id", id).maybeSingle();
  if (have && have.full_text) { console.log(`  ${id}  already have full text`); return; }

  const meta = await fetchMeta(id);
  await sleep(3000);                       // arXiv asks for one request every few seconds
  const sections = await fetchSections(id);
  const chars = sections.reduce((n, s) => n + s.text.length, 0);

  const row = {
    arxiv_id: id, ...meta,
    sections, full_text: sections.length > 0,
    chars: chars || meta.abstract.length
  };
  const { error } = await sb.from("corpus_papers").upsert(row);
  if (error) throw new Error(error.message);

  console.log(`  ${id}  ${sections.length ? `${sections.length} sections, ${chars.toLocaleString()} chars` : "abstract only"}  ${meta.title.slice(0, 60)}`);
}

/* ---------------- run ---------------- */

const files = fs.readdirSync(DIR).filter(f => f.endsWith(".json"));
let papers = new Set();
for (const f of files) (await loadTrack(f)).forEach(p => papers.add(p));

console.log(`\nfetching ${papers.size} papers from arXiv`);
for (const id of papers) {
  try { await ingestPaper(id); }
  catch (e) { console.warn(`  ${id}  FAILED: ${e.message}`); }
  await sleep(3000);
}

const { count } = await sb.from("corpus_papers").select("arxiv_id", { count: "exact", head: true }).eq("full_text", true);
console.log(`\ndone. ${count ?? 0} of ${papers.size} papers have full section text.`);
