// Runs once a day on GitHub Actions (free).
// 1. Finds new AI papers on Hugging Face Daily Papers
// 2. Explains each in simple English (shared by all users)
// 3. Builds each person's personal picks for today
// 4. Sends a push notification to their phone
// It also keeps the free Supabase database awake.

import { admin } from "../lib/server.js";
import { completeJSON } from "../lib/llm.js";
import * as P from "../lib/prompts.js";
import { sendToUser } from "../lib/push.js";

const sb = admin();
const TODAY = P.today();
const GAP = Number(process.env.LLM_GAP_MS || 7000); // pause between AI calls to stay inside free rate limits
const MAX_PAPERS = Number(process.env.MAX_NEW_PAPERS || 12);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

async function fetchDay(date) {
  try {
    const r = await fetch(`https://huggingface.co/api/daily_papers?date=${date}`, { headers: { accept: "application/json" } });
    if (!r.ok) { console.warn("HF", date, r.status); return []; }
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch (e) { console.warn("HF fetch failed", date, e.message); return []; }
}

function normPaper(x) {
  const p = x.paper || x;
  const id = String(p.id || "").trim();
  if (!/^\d{4}\.\d{4,5}$/.test(id)) return null;
  const authors = (p.authors || []).map(a => a && a.name).filter(Boolean);
  return {
    id,
    title: String(p.title || x.title || "").replace(/\s+/g, " ").trim(),
    authors: authors.slice(0, 4).join(", ") + (authors.length > 4 ? " et al." : ""),
    abstract: String(p.summary || x.summary || "").replace(/\s+/g, " ").slice(0, 1200),
    upvotes: Number(p.upvotes ?? x.upvotes ?? 0) || 0
  };
}

async function collectPapers() {
  const raw = [...(await fetchDay(daysAgo(0))), ...(await fetchDay(daysAgo(1))), ...(await fetchDay(daysAgo(2)))];
  const byId = new Map();
  for (const x of raw) { const p = normPaper(x); if (p && p.title && !byId.has(p.id)) byId.set(p.id, p); }
  const all = [...byId.values()].sort((a, b) => b.upvotes - a.upvotes);
  if (!all.length) return [];
  const { data: existing } = await sb.from("papers").select("id").in("id", all.map(p => p.id));
  const seen = new Set((existing || []).map(r => r.id));
  return all.filter(p => !seen.has(p.id)).slice(0, MAX_PAPERS);
}

async function explainPapers(papers) {
  const rows = [];
  for (let i = 0; i < papers.length; i += 6) {
    const batch = papers.slice(i, i + 6);
    try {
      const d = await completeJSON([{ role: "user", content: P.papersDigestPrompt(batch) }], { temperature: 0.3 });
      const byId = new Map((d.papers || []).map(x => [String(x.id), x]));
      for (const p of batch) {
        const s = byId.get(p.id) || {};
        rows.push({
          id: p.id, day: TODAY, title: p.title, authors: p.authors,
          simple: String(s.simple || p.abstract.slice(0, 300)),
          why: String(s.why || ""),
          area: P.AREAS.includes(s.area) ? s.area : "LLM internals",
          upvotes: p.upvotes,
          url: `https://huggingface.co/papers/${p.id}`
        });
      }
    } catch (e) { console.warn("paper summaries failed", e.message); }
    await sleep(GAP);
  }
  if (rows.length) {
    const { error } = await sb.from("papers").upsert(rows);
    if (error) console.error("save papers", error.message);
  }
  return rows;
}

function profileBlock(p, learned, quizzes) {
  return "LEARNER PROFILE\n" +
    "Name: " + (p.name || "-") + "\n" +
    "Role: " + (p.role || "AI/ML Engineer") + "; experience: " + (p.exp || "-") + "\n" +
    "Goal: " + (p.goal || "-") + "\n" +
    "Strong areas: " + ((p.strong || []).join(", ") || "-") + "\n" +
    "Weak areas (highest priority): " + ((p.weak || []).join(", ") || "-") + "\n" +
    "Daily study time: " + (p.time || "-") + "\n" +
    "About them: " + (p.notes || "-") + "\n" +
    "Recently learned: " + (learned.join("; ") || "nothing yet") + "\n" +
    "Recent quiz marks: " + (quizzes.join("; ") || "none yet");
}

async function personalize(recentPapers) {
  const { data: profiles, error } = await sb.from("profiles").select("user_id, data");
  if (error) { console.error("profiles", error.message); return; }
  console.log(`Personalizing for ${profiles.length} people`);

  for (const row of profiles) {
    const uid = row.user_id, p = row.data || {};
    try {
      const [{ data: l }, { data: q }, { data: existing }] = await Promise.all([
        sb.from("learned").select("item").eq("user_id", uid).order("created_at", { ascending: false }).limit(25),
        sb.from("quizzes").select("item, area, score, total").eq("user_id", uid).order("created_at", { ascending: false }).limit(12),
        sb.from("recs").select("day").eq("user_id", uid).eq("day", TODAY).maybeSingle()
      ]);
      let focus = "";
      if (!existing) {
        const block = profileBlock(p, (l || []).map(x => x.item?.title).filter(Boolean),
          (q || []).map(x => `${x.item?.title} (${x.area}): ${x.score}/${x.total}`));
        const d = await completeJSON([{ role: "user", content: P.recsPrompt(block, TODAY, recentPapers) }]);
        const items = (d.items || []).slice(0, 8).map(P.normItem);
        focus = String(d.focus || "");
        if (items.length) await sb.from("recs").upsert({ user_id: uid, day: TODAY, focus, items });
        await sleep(GAP);
      }

      const weak = new Set(p.weak || []);
      const fresh = recentPapers.filter(x => x.day === TODAY);
      const mine = fresh.filter(x => weak.has(x.area));
      let body = focus || "Your study picks for today are ready.";
      if (mine.length) body += ` Plus ${mine.length} new paper${mine.length > 1 ? "s" : ""} in your focus areas.`;
      else if (fresh.length) body += ` Plus ${fresh.length} new AI paper${fresh.length > 1 ? "s" : ""} explained simply.`;
      const sent = await sendToUser(sb, uid, { title: "Today's study picks", body, url: "/#home" });
      console.log(`user ${uid.slice(0, 8)}: picks ${existing ? "already there" : "made"}, notified ${sent} device(s)`);
    } catch (e) {
      console.error(`user ${uid.slice(0, 8)} failed:`, e.message);
      await sleep(GAP);
    }
  }
}

async function cleanup() {
  await sb.from("papers").delete().lt("day", daysAgo(45));
  await sb.from("ai_usage").delete().lt("day", daysAgo(7));
}

(async () => {
  console.log("Daily run", TODAY);
  const fresh = await collectPapers();
  console.log(`Found ${fresh.length} new papers`);
  if (fresh.length) await explainPapers(fresh);
  const { data: recent } = await sb.from("papers").select("id, title, area, day").gte("day", daysAgo(3)).order("upvotes", { ascending: false }).limit(15);
  await personalize(recent || []);
  await cleanup();
  console.log("Done");
})().catch(e => { console.error(e); process.exit(1); });
