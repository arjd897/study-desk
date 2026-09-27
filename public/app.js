(function () {
"use strict";

/* ================= constants ================= */
const AREAS = ["LLM internals","Training & scaling","Fine-tuning & alignment","Reasoning models","Inference & serving","RAG & search","Agents & tools","AI system design","Evals & monitoring","MLOps & deployment","Multimodal & diffusion","ML & math foundations"];
const KIND = { "paper": "Paper", "concept": "Concept", "system-design": "System design", "trend": "New & notable" };
const QUICK = ["System design of AI apps","RAG at scale","LLM inference & serving","Agents & MCP","RLHF, DPO & GRPO","Mixture of Experts","Evals for LLM apps","Distributed training"];
const GOALS = ["Crack senior / lead AI/ML interviews","Become a strong LLM engineer at work","Move toward AI research"];
const TIMES = ["1 hour","2 hours","3–4 hours","5+ hours"];

/* ================= state ================= */
const S = { profile: null, recs: null, learned: {}, quizzes: [], glossary: {}, paths: [], papers: [] };
let sb = null, cfg = {}, user = null;
let current = "home", prevView = "home", recsTried = false;
let recovering = /type=recovery/.test(location.hash);
const main = document.getElementById("main");
const tabs = document.getElementById("tabs");

/* ================= helpers ================= */
function el(tag, attrs) {
  const n = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.slice(0, 2) === "on" && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else n.setAttribute(k, String(v));
  }
  for (const c of Array.prototype.slice.call(arguments, 2).flat(Infinity)) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}
const slug = t => { const s = String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80); return s || "item-" + Date.now().toString(36); };
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const longDate = () => new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
const shortDate = ts => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
function status(node, text, kind) {
  node.className = "status" + (kind === "err" ? " err" : "");
  node.replaceChildren();
  if (kind === "busy") node.append(el("span", { class: "pulse" }));
  if (text) node.append(text);
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), 3500);
}
function normItem(x) {
  x = x || {};
  const title = String(x.title || "Untitled").trim();
  const ax = String(x.arxiv || "").trim();
  return {
    id: x.id || slug(title), title,
    kind: KIND[x.kind] ? x.kind : "concept",
    detail: String(x.detail || ""),
    arxiv: /^\d{4}\.\d{4,5}$/.test(ax) ? ax : "",
    area: AREAS.includes(x.area) ? x.area : "LLM internals",
    level: String(x.level || "intermediate"),
    minutes: Number(x.minutes) || 30,
    why: String(x.why || "")
  };
}

/* ================= tiny safe markdown ================= */
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => "<code>" + codes[+i] + "</code>");
  return s;
}
function mdTable(rows) {
  const cells = r => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
  const body = rows.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r));
  if (!body.length) return "";
  let h = '<div class="scroll"><table><thead><tr>' + cells(body[0]).map(c => "<th>" + inline(esc(c)) + "</th>").join("") + "</tr></thead><tbody>";
  for (const r of body.slice(1)) h += "<tr>" + cells(r).map(c => "<td>" + inline(esc(c)) + "</td>").join("") + "</tr>";
  return h + "</tbody></table></div>";
}
function md(src) {
  const L = String(src || "").replace(/\r/g, "").split("\n"); const out = []; let i = 0;
  const starter = /^(#{1,4}\s|```|\s*[-*+]\s+|\s*\d+[.)]\s+|\s*\|.*\|\s*$|>\s?)/;
  while (i < L.length) {
    const l = L[i];
    if (/^```/.test(l)) { const b = []; i++; while (i < L.length && !/^```/.test(L[i])) { b.push(L[i]); i++; } i++; out.push("<pre><code>" + esc(b.join("\n")) + "</code></pre>"); continue; }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { const n = Math.max(2, Math.min(h[1].length, 4)); out.push("<h" + n + ">" + inline(esc(h[2])) + "</h" + n + ">"); i++; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) { const r = []; while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) { r.push(L[i]); i++; } out.push(mdTable(r)); continue; }
    if (/^\s*[-*+]\s+/.test(l)) { const it = []; while (i < L.length && /^\s*[-*+]\s+/.test(L[i])) { it.push(L[i].replace(/^\s*[-*+]\s+/, "")); i++; } out.push("<ul>" + it.map(x => "<li>" + inline(esc(x)) + "</li>").join("") + "</ul>"); continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { const it = []; while (i < L.length && (/^\s*\d+[.)]\s+/.test(L[i]) || /^\s{2,}[-*+]\s+/.test(L[i]))) { it.push(L[i].replace(/^\s*(\d+[.)]|[-*+])\s+/, "")); i++; } out.push("<ol>" + it.map(x => "<li>" + inline(esc(x)) + "</li>").join("") + "</ol>"); continue; }
    if (/^>\s?/.test(l)) { const q = []; while (i < L.length && /^>\s?/.test(L[i])) { q.push(L[i].replace(/^>\s?/, "")); i++; } out.push("<blockquote>" + inline(esc(q.join(" "))) + "</blockquote>"); continue; }
    if (!l.trim()) { i++; continue; }
    const p = [l]; i++;
    while (i < L.length && L[i].trim() && !starter.test(L[i])) { p.push(L[i]); i++; }
    out.push("<p>" + inline(esc(p.join(" "))) + "</p>");
  }
  return out.join("");
}

/* ================= server calls ================= */
async function token() {
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.access_token : "";
}
async function apiJSON(payload) {
  const r = await fetch("/api/ai", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + (await token()) },
    body: JSON.stringify(payload)
  });
  let d = null; try { d = await r.json(); } catch (e) { /* not JSON */ }
  if (!r.ok) throw { message: (d && d.message) || "Something went wrong. Try again." };
  return d;
}
async function apiStream(payload, onText, signal) {
  const r = await fetch("/api/ai", {
    method: "POST", signal,
    headers: { "content-type": "application/json", authorization: "Bearer " + (await token()) },
    body: JSON.stringify(payload)
  });
  if (!r.ok) { let d = null; try { d = await r.json(); } catch (e) { /* ignore */ } throw { message: (d && d.message) || "Something went wrong. Try again." }; }
  const reader = r.body.getReader(); const dec = new TextDecoder(); let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    const cut = text.indexOf("[[ERROR]]");
    if (cut >= 0) { text = text.slice(0, cut).trim(); onText(text); throw { message: "The answer was interrupted. Try again.", text }; }
    onText(text);
  }
  if (!text.trim()) throw { message: "No answer came back. Try again." };
  return text;
}
function profileBlock() {
  const p = S.profile || {};
  const learned = Object.values(S.learned).sort((a, b) => b.date - a.date).slice(0, 25).map(x => x.title);
  const qz = S.quizzes.slice(0, 12).map(q => q.item.title + " (" + q.area + "): " + q.score + "/" + q.total);
  return "LEARNER PROFILE\n" +
    "Name: " + (p.name || "-") + "\n" +
    "Role: " + (p.role || "AI/ML Engineer") + "; experience: " + (p.exp || "-") + "\n" +
    "Goal: " + (p.goal || GOALS[0]) + "\n" +
    "Strong areas: " + ((p.strong || []).join(", ") || "-") + "\n" +
    "Weak areas (highest priority): " + ((p.weak || []).join(", ") || "-") + "\n" +
    "Daily study time: " + (p.time || "-") + "\n" +
    "About them: " + (p.notes || "-") + "\n" +
    "Recently learned: " + (learned.join("; ") || "nothing yet") + "\n" +
    "Recent quiz marks: " + (qz.join("; ") || "none yet");
}

/* ================= database ================= */
async function loadAll() {
  const uid = user.id;
  const [p, l, q, g, pa, r, pp] = await Promise.all([
    sb.from("profiles").select("data").eq("user_id", uid).maybeSingle(),
    sb.from("learned").select("item_id, item, created_at").eq("user_id", uid),
    sb.from("quizzes").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(300),
    sb.from("glossary").select("*").eq("user_id", uid),
    sb.from("paths").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    sb.from("recs").select("*").eq("user_id", uid).order("day", { ascending: false }).limit(1),
    sb.from("papers").select("*").gte("day", daysAgo(10)).order("day", { ascending: false }).order("upvotes", { ascending: false }).limit(80)
  ]);
  const firstErr = [p, l, q, g, pa, r, pp].find(x => x.error);
  if (firstErr) throw new Error(firstErr.error.message);
  S.profile = p.data ? p.data.data : null;
  S.learned = {}; (l.data || []).forEach(x => { S.learned[x.item_id] = Object.assign({}, x.item, { date: Date.parse(x.created_at) }); });
  S.quizzes = (q.data || []).map(x => ({ id: x.id, itemId: x.item_id, item: x.item, area: x.area, score: x.score, total: x.total, date: Date.parse(x.created_at) }));
  S.glossary = {}; (g.data || []).forEach(x => { S.glossary[x.term_id] = x; });
  S.paths = (pa.data || []).map(x => ({ id: x.id, topic: x.topic, overview: x.overview, steps: x.steps, date: Date.parse(x.created_at) }));
  S.recs = r.data && r.data[0] ? { day: r.data[0].day, focus: r.data[0].focus, items: r.data[0].items } : null;
  S.papers = pp.data || [];
}
async function write(promise) {
  const { error } = await promise;
  if (error) { console.error(error); toast("Couldn't save: " + error.message); return false; }
  return true;
}
const db = {
  saveProfile: (data) => write(sb.from("profiles").upsert({ user_id: user.id, data, updated_at: new Date().toISOString() })),
  saveRecs: (recs) => write(sb.from("recs").upsert({ user_id: user.id, day: recs.day, focus: recs.focus, items: recs.items })),
  learn: (item) => write(sb.from("learned").upsert({ user_id: user.id, item_id: item.id, item })),
  unlearn: (id) => write(sb.from("learned").delete().eq("user_id", user.id).eq("item_id", id)),
  addQuiz: (row) => write(sb.from("quizzes").insert(Object.assign({ user_id: user.id }, row))),
  addTerm: (row) => write(sb.from("glossary").upsert(Object.assign({ user_id: user.id }, row), { onConflict: "user_id,term_id", ignoreDuplicates: true })),
  addPath: (p) => write(sb.from("paths").insert({ id: p.id, user_id: user.id, topic: p.topic, overview: p.overview, steps: p.steps })),
  delPath: (id) => write(sb.from("paths").delete().eq("user_id", user.id).eq("id", id)),
  putNote: (itemId, text) => write(sb.from("notes").upsert({ user_id: user.id, item_id: itemId, text })),
  async getNote(itemId) {
    const { data } = await sb.from("notes").select("text").eq("user_id", user.id).eq("item_id", itemId).maybeSingle();
    return data ? data.text : null;
  }
};

/* ================= navigation ================= */
function show(view, arg) {
  if (view !== "learn") prevView = view;
  current = view;
  tabs.classList.toggle("hidden", view === "onboard" || view === "auth");
  tabs.querySelectorAll("button").forEach(b => {
    if (b.dataset.view === view || (view === "learn" && b.dataset.view === prevView)) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
  ({ home: renderHome, new: renderNew, explore: renderExplore, glossary: renderGlossary, progress: renderProgress,
     onboard: renderOnboard, learn: renderLearn, auth: renderAuth, reset: renderNewPassword })[view](arg);
}
tabs.addEventListener("click", e => { const b = e.target.closest("button[data-view]"); if (b) show(b.dataset.view); });
const openItem = item => show("learn", normItem(item));

/* ================= shared UI ================= */
function itemCard(item, opts) {
  opts = opts || {};
  const done = !!S.learned[item.id];
  return el("button", { class: "item" + (done ? " done" : ""), type: "button", onclick: () => openItem(item) },
    el("div", { class: "item-top" },
      el("span", { class: "tag k-" + item.kind }, KIND[item.kind] || "Concept"),
      el("span", {}, item.area), el("span", {}, item.level), el("span", {}, item.minutes + " min"),
      done ? el("span", { class: "done-mark" }, "Learned ✓") : null),
    el("p", { class: "item-title" }, item.title),
    item.detail ? el("p", { class: "item-detail" }, item.detail) : null,
    item.why ? el("p", { class: "item-why" }, item.why) : null,
    opts.note ? el("p", { class: "item-note" }, opts.note) : null);
}
function paperCard(p) {
  const asItem = { title: p.title, kind: "paper", detail: p.authors || "", arxiv: p.id, area: p.area, level: "advanced", minutes: 30, why: p.why || "" };
  return el("article", { class: "paper" },
    el("div", { class: "item-top" }, el("span", { class: "tag k-paper" }, "New paper"), el("span", {}, p.area || ""), p.upvotes ? el("span", {}, "▲ " + p.upvotes) : null),
    el("h3", {}, p.title),
    p.authors ? el("p", { class: "by" }, p.authors) : null,
    p.simple ? el("p", { class: "simple" }, p.simple) : null,
    p.why ? el("p", { class: "why" }, p.why) : null,
    el("div", { class: "row" },
      el("button", { class: "btn quiet", type: "button", onclick: () => openItem(asItem) }, "Teach me this"),
      el("a", { href: p.url || ("https://huggingface.co/papers/" + p.id), target: "_blank", rel: "noopener" }, "Paper page"),
      el("a", { href: "https://arxiv.org/abs/" + p.id, target: "_blank", rel: "noopener" }, "arXiv")));
}

/* ================= auth ================= */
function renderAuth(msg) {
  const email = el("input", { type: "email", class: "field", placeholder: "Email", autocomplete: "email", "aria-label": "Email" });
  const pass = el("input", { type: "password", class: "field", placeholder: "Password (8+ characters)", autocomplete: "current-password", "aria-label": "Password" });
  const st = el("p", { class: "status" });
  if (typeof msg === "string") status(st, msg);
  const go = async (mode) => {
    const e = email.value.trim(), p = pass.value;
    if (!e || (mode !== "forgot" && p.length < 8)) { status(st, mode === "forgot" ? "Type your email first." : "Enter your email and a password of at least 8 characters.", "err"); return; }
    status(st, "One moment…", "busy");
    try {
      if (mode === "in") {
        const { error } = await sb.auth.signInWithPassword({ email: e, password: p });
        if (error) throw error;
      } else if (mode === "up") {
        const { data, error } = await sb.auth.signUp({ email: e, password: p, options: { emailRedirectTo: location.origin } });
        if (error) throw error;
        if (!data.session) status(st, "Account created. Check your email and tap the confirm link, then sign in here.");
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(e, { redirectTo: location.origin });
        if (error) throw error;
        status(st, "Check your email for a link to set a new password.");
      }
    } catch (err) { status(st, err.message || "That didn't work. Try again.", "err"); }
  };
  main.replaceChildren(el("section", { class: "view auth" },
    el("div", { class: "brand" }, el("img", { src: "/icons/icon-192.png", alt: "" }), el("b", {}, "Study Desk")),
    el("h1", { class: "page" }, "Your personal AI/ML teacher"),
    el("p", { class: "lead" }, "Daily picks, lessons in simple English, tests with marks, and alerts when new papers come out."),
    email, pass,
    el("div", { class: "row" },
      el("button", { class: "btn", type: "button", onclick: () => go("in") }, "Sign in"),
      el("button", { class: "btn ghost", type: "button", onclick: () => go("up") }, "Create account")),
    el("button", { class: "link", type: "button", onclick: () => go("forgot") }, "Forgot password"),
    st));
}
function renderNewPassword() {
  const pass = el("input", { type: "password", class: "field", placeholder: "New password (8+ characters)", "aria-label": "New password" });
  const st = el("p", { class: "status" });
  main.replaceChildren(el("section", { class: "view auth" },
    el("h1", { class: "page" }, "Set a new password"), pass,
    el("div", { class: "row" }, el("button", { class: "btn", type: "button", onclick: async () => {
      if (pass.value.length < 8) { status(st, "Use at least 8 characters.", "err"); return; }
      const { error } = await sb.auth.updateUser({ password: pass.value });
      if (error) status(st, error.message, "err"); else { recovering = false; toast("Password updated"); await afterSignIn(); }
    } }, "Save password")), st));
}

/* ================= home ================= */
const recsFresh = () => !!(S.recs && S.recs.day === today() && S.recs.items && S.recs.items.length);
function reviewItems() {
  const latest = {};
  for (const q of S.quizzes) if (!latest[q.itemId] || latest[q.itemId].date < q.date) latest[q.itemId] = q;
  return Object.values(latest).filter(q => q.item && q.score / q.total < 0.6).sort((a, b) => b.date - a.date);
}
function nextInPaths() {
  for (const p of S.paths) { const i = p.steps.findIndex(s => !S.learned[s.id]); if (i >= 0) return { path: p, step: p.steps[i], index: i }; }
  return null;
}
function renderHome() {
  const p = S.profile || {};
  const v = el("section", { class: "view" },
    el("p", { class: "date" }, longDate()),
    el("h1", { class: "page" }, p.name ? "Hello, " + p.name : "Hello"),
    el("p", { class: "lead" }, "Here's what to learn next, picked for your goal and your weak spots. Tap anything for a simple lesson, a test and key terms."));
  const box = el("div", {});
  v.append(box);
  drawRecs(box);

  const weak = new Set(p.weak || []);
  const fresh = S.papers.filter(x => x.day >= daysAgo(2) && weak.has(x.area)).slice(0, 2);
  if (fresh.length) v.append(el("h2", { class: "sec" }, "New papers in your focus areas"), el("div", { class: "list" }, fresh.map(paperCard)),
    el("button", { class: "link", type: "button", onclick: () => show("new") }, "See all new papers"));

  const rev = reviewItems();
  if (rev.length) v.append(el("h2", { class: "sec" }, "Needs another look"),
    el("p", { class: "hint" }, "You scored under 60% on these. Re-read the lesson, then retake the test."),
    el("div", { class: "list" }, rev.slice(0, 3).map(q => itemCard(normItem(q.item), { note: "Last mark " + q.score + "/" + q.total }))));

  const nx = nextInPaths();
  if (nx) v.append(el("h2", { class: "sec" }, "Continue your path"),
    el("p", { class: "hint" }, "Step " + (nx.index + 1) + " of " + nx.path.steps.length + " in " + nx.path.topic), itemCard(nx.step));

  main.replaceChildren(v);
  if (!recsFresh() && !recsTried) { recsTried = true; genRecs(box, false); }
}
function drawRecs(box) {
  box.replaceChildren();
  const fresh = recsFresh();
  if (S.recs && S.recs.items && S.recs.items.length) {
    box.append(el("div", { class: "focus" }, el("span", { class: "focus-label" }, fresh ? "Today's focus" : "Your picks from " + S.recs.day), el("p", {}, S.recs.focus || "")),
      el("div", { class: "list" }, S.recs.items.map(x => itemCard(normItem(x)))));
  }
  const st = el("p", { class: "status" });
  box.append(el("div", { class: "row" },
    el("button", { class: "btn" + (fresh ? " ghost" : ""), type: "button", onclick: e => genRecs(box, true, e.currentTarget) }, fresh ? "Get different picks" : "Get today's picks")), st);
}
async function genRecs(box, manual, btn) {
  const st = box.querySelector(".status");
  if (btn) btn.disabled = true;
  status(st, "Choosing what you should study today. This takes about 20 to 40 seconds.", "busy");
  try {
    const papers = S.papers.filter(x => x.day >= daysAgo(3)).slice(0, 15).map(x => ({ id: x.id, title: x.title, area: x.area }));
    const d = await apiJSON({ task: "recs", profile: profileBlock(), papers });
    S.recs = { day: today(), focus: d.focus, items: d.items };
    db.saveRecs(S.recs);
    if (current === "home") drawRecs(box);
  } catch (e) {
    if (btn) btn.disabled = false;
    status(st, e.message, "err");
  }
}

/* ================= new papers ================= */
function renderNew() {
  const weak = new Set((S.profile && S.profile.weak) || []);
  let mineOnly = false;
  const list = el("div", {});
  const draw = () => {
    const ps = S.papers.filter(p => !mineOnly || weak.has(p.area));
    if (!ps.length) {
      list.replaceChildren(el("p", { class: "hint" }, S.papers.length ? "No new papers in your focus areas yet. Switch to All." :
        "New papers arrive every morning after the daily job runs. If this stays empty, check the setup guide's GitHub Actions step."));
      return;
    }
    const byDay = {};
    ps.forEach(p => { (byDay[p.day] = byDay[p.day] || []).push(p); });
    list.replaceChildren(...Object.keys(byDay).sort().reverse().map(d =>
      el("div", {}, el("p", { class: "day-h" }, d === today() ? "Today" : new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })),
        el("div", { class: "list" }, byDay[d].map(paperCard)))));
  };
  const all = el("button", { class: "chip", type: "button", "aria-pressed": "true" }, "All");
  const mine = el("button", { class: "chip", type: "button", "aria-pressed": "false" }, "My focus areas");
  all.onclick = () => { mineOnly = false; all.setAttribute("aria-pressed", "true"); mine.setAttribute("aria-pressed", "false"); draw(); };
  mine.onclick = () => { mineOnly = true; mine.setAttribute("aria-pressed", "true"); all.setAttribute("aria-pressed", "false"); draw(); };
  main.replaceChildren(el("section", { class: "view" },
    el("h1", { class: "page" }, "What's new in AI"),
    el("p", { class: "lead" }, "The most upvoted papers from Hugging Face Daily Papers, explained simply. Updated every morning."),
    el("div", { class: "chips" }, all, mine), list));
  draw();
}

/* ================= explore ================= */
function renderExplore(openId) {
  const inp = el("input", { type: "text", class: "field", placeholder: "e.g. KV cache, speculative decoding, RAG evals", "aria-label": "Topic to learn", maxlength: "140" });
  const go = el("button", { class: "btn", type: "submit" }, "Build my path");
  const st = el("p", { class: "status" });
  const v = el("section", { class: "view" },
    el("h1", { class: "page" }, "Explore a topic"),
    el("p", { class: "lead" }, "Type anything you want to master. You'll get a study path in order, from the basics to the research papers that matter."),
    el("form", { class: "ask", onsubmit: e => { e.preventDefault(); const t = inp.value.trim(); if (t) genPath(t, go, st); } }, inp, go),
    el("div", { class: "chips" }, QUICK.map(q => el("button", { type: "button", class: "chip", onclick: () => { inp.value = q; genPath(q, go, st); } }, q))),
    st);
  if (S.paths.length) v.append(el("h2", { class: "sec" }, "Your paths"), S.paths.map(p => pathCard(p, p.id === openId)));
  main.replaceChildren(v);
}
function pathCard(p, open) {
  const n = p.steps.filter(s => S.learned[s.id]).length;
  let armed = false;
  const del = el("button", { class: "link danger", type: "button", onclick: async () => {
    if (!armed) { armed = true; del.textContent = "Tap again to delete this path"; return; }
    await db.delPath(p.id); S.paths = S.paths.filter(x => x.id !== p.id); show("explore");
  } }, "Delete this path");
  return el("details", { class: "path", open: open ? true : null },
    el("summary", {}, el("span", { class: "path-title" }, p.topic), el("span", { class: "path-prog" }, n + " of " + p.steps.length + " done")),
    p.overview ? el("p", { class: "hint" }, p.overview) : null,
    el("ol", { class: "steps" }, p.steps.map(s => el("li", {}, itemCard(normItem(s))))),
    del);
}
async function genPath(topic, btn, st) {
  btn.disabled = true;
  status(st, "Building your path for “" + topic + "”. This takes about 30 seconds.", "busy");
  try {
    const d = await apiJSON({ task: "path", topic, profile: profileBlock() });
    const path = { id: slug(d.topic).slice(0, 60) + "-" + Date.now().toString(36), topic: d.topic, overview: d.overview, steps: d.steps, date: Date.now() };
    await db.addPath(path);
    S.paths.unshift(path);
    if (current === "explore") show("explore", path.id);
  } catch (e) { btn.disabled = false; status(st, e.message, "err"); }
}

/* ================= lesson ================= */
function renderLearn(item) {
  let curText = "", turns = [];
  const st = el("p", { class: "status" });
  const stop = el("button", { class: "btn ghost hidden", type: "button" }, "Stop");
  const reading = el("article", { class: "reading" });
  const actions = el("div", { class: "actions hidden" });
  const quizBox = el("div", { class: "quiz" });
  const chatBox = el("div", { class: "chat hidden" });
  main.replaceChildren(el("section", { class: "view" },
    el("button", { class: "link back", type: "button", onclick: () => show(prevView) }, "← Back"),
    el("header", { class: "learn-head" },
      el("span", { class: "tag k-" + item.kind }, KIND[item.kind]),
      el("h1", { class: "page" }, item.title),
      el("div", { class: "meta-row" }, item.detail ? el("span", {}, item.detail) : null, el("span", {}, item.area), el("span", {}, item.level), el("span", {}, item.minutes + " min")),
      el("div", { class: "src-links" },
        item.arxiv ? el("a", { href: "https://arxiv.org/abs/" + item.arxiv, target: "_blank", rel: "noopener" }, "Open paper on arXiv") : null,
        item.kind === "paper" && !item.arxiv ? el("a", { href: "https://arxiv.org/search/?searchtype=all&query=" + encodeURIComponent(item.title), target: "_blank", rel: "noopener" }, "Find on arXiv") : null,
        item.kind === "paper" ? el("a", { href: "https://scholar.google.com/scholar?q=" + encodeURIComponent(item.title), target: "_blank", rel: "noopener" }, "Google Scholar") : null)),
    el("div", { class: "row" }, stop), st, reading, actions, quizBox, chatBox));

  function drawActions() {
    const learned = !!S.learned[item.id];
    const aSt = el("p", { class: "status" });
    const bLearn = el("button", { class: "btn" + (learned ? " quiet" : ""), type: "button", onclick: async () => {
      if (S.learned[item.id]) { delete S.learned[item.id]; await db.unlearn(item.id); }
      else { S.learned[item.id] = Object.assign({}, item, { date: Date.now() }); await db.learn(item); }
      drawActions();
    } }, learned ? "Learned ✓ (tap to undo)" : "Mark as learned");
    const bQuiz = el("button", { class: "btn ghost", type: "button", onclick: () => startQuiz(bQuiz) }, "Test me");
    const bTerms = el("button", { class: "btn ghost", type: "button", onclick: () => saveTerms(bTerms, aSt) }, "Save key terms");
    actions.replaceChildren(el("div", { class: "row" }, bLearn, bQuiz, bTerms),
      el("div", { class: "row" }, el("button", { class: "link", type: "button", onclick: () => explain(true) }, "Explain again differently")), aSt);
    actions.classList.remove("hidden");
    drawChat();
  }

  async function explain(fresh) {
    actions.classList.add("hidden"); quizBox.replaceChildren();
    const ctl = new AbortController();
    stop.classList.remove("hidden"); stop.onclick = () => ctl.abort();
    status(st, "Writing your lesson. Clear explanations take 20 to 60 seconds.", "busy");
    if (fresh) reading.replaceChildren();
    try {
      curText = await apiStream({ task: "explain", item, fresh, profile: profileBlock() },
        text => { if (st.firstChild) status(st, ""); reading.innerHTML = md(text); }, ctl.signal);
      db.putNote(item.id, curText);
      status(st, "");
    } catch (e) {
      if (e && e.name === "AbortError") status(st, "Stopped.");
      else {
        if (e.text) { curText = e.text; reading.innerHTML = md(e.text); }
        status(st, e.message || "Something went wrong.", "err");
        st.append(" ", el("button", { class: "link", type: "button", onclick: () => explain(true) }, "Try again"));
      }
    } finally {
      stop.classList.add("hidden");
      if (curText) drawActions();
    }
  }

  async function startQuiz(btn) {
    btn.disabled = true;
    const qst = el("p", { class: "status" });
    quizBox.replaceChildren(el("h2", { class: "sec" }, "Quick test"), qst);
    status(qst, "Making 5 questions for you…", "busy");
    quizBox.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const d = await apiJSON({ task: "quiz", item, lesson: curText.slice(0, 9000) });
      drawQuiz(d.questions);
    } catch (e) { status(qst, e.message, "err"); }
    finally { btn.disabled = false; }
  }

  function drawQuiz(qs) {
    const sets = qs.map((q, i) => el("fieldset", {}, el("legend", {}, (i + 1) + ". " + q.q),
      q.options.map((o, j) => el("label", { class: "opt" }, el("input", { type: "radio", name: "q" + i, value: String(j) }), el("span", {}, o)))));
    const qst = el("p", { class: "status" });
    const submit = el("button", { class: "btn", type: "button", onclick: () => {
      const picks = qs.map((q, i) => { const c = quizBox.querySelector('input[name="q' + i + '"]:checked'); return c ? Number(c.value) : -1; });
      if (picks.some(p => p < 0)) { status(qst, "Answer every question first.", "err"); return; }
      let score = 0;
      qs.forEach((q, i) => {
        const ok = picks[i] === q.answer; if (ok) score++;
        sets[i].querySelectorAll(".opt").forEach((lab, j) => {
          if (j === q.answer) lab.classList.add("right"); else if (j === picks[i]) lab.classList.add("wrong");
          lab.querySelector("input").disabled = true;
        });
        sets[i].append(el("p", { class: "why" }, (ok ? "Correct. " : "Not quite. ") + q.why));
      });
      submit.remove(); status(qst, "");
      const pct = score / qs.length;
      const msg = pct >= 0.8 ? "Strong. You could explain this in an interview." : pct >= 0.6 ? "Good. Re-read the parts you missed, then move on." : "Worth another pass. Re-read the lesson or ask a follow-up, then retake the test.";
      quizBox.insertBefore(el("div", { class: "grade-wrap" }, el("div", { class: "grade", "aria-label": "Score " + score + " out of " + qs.length }, score + "/" + qs.length), el("p", {}, msg)), sets[0]);
      const row = { item_id: item.id, item, area: item.area, score, total: qs.length };
      S.quizzes.unshift({ itemId: item.id, item, area: item.area, score, total: qs.length, date: Date.now() });
      db.addQuiz(row);
      const again = el("button", { class: "btn ghost", type: "button", onclick: () => startQuiz(again) }, "New test");
      quizBox.append(el("div", { class: "row" }, again));
    } }, "Check my answers");
    quizBox.replaceChildren(el("h2", { class: "sec" }, "Quick test"), sets, qst, el("div", { class: "row" }, submit));
  }

  async function saveTerms(btn, aSt) {
    btn.disabled = true;
    status(aSt, "Picking out the key terms…", "busy");
    try {
      const d = await apiJSON({ task: "terms", item, lesson: curText.slice(0, 9000) });
      let added = 0;
      for (const t of d.terms) {
        const id = slug(t.term);
        if (S.glossary[id]) continue;
        const row = { term_id: id, term: t.term, meaning: t.meaning, example: t.example, source: item.title, area: item.area };
        S.glossary[id] = row; db.addTerm(row); added++;
      }
      status(aSt, added ? "Saved " + added + " new term" + (added > 1 ? "s" : "") + " to your glossary." : "These terms are already in your glossary.");
    } catch (e) { status(aSt, e.message, "err"); }
    finally { btn.disabled = false; }
  }

  function drawChat() {
    chatBox.classList.remove("hidden");
    if (chatBox.dataset.ready) return;
    chatBox.dataset.ready = "1";
    const log = el("div", {});
    const inp = el("input", { type: "text", class: "field", placeholder: "e.g. Why divide by √d? Explain with numbers", "aria-label": "Ask a follow-up question" });
    const send = el("button", { class: "btn", type: "submit" }, "Ask");
    const cst = el("p", { class: "status" });
    chatBox.replaceChildren(el("h2", { class: "sec" }, "Ask a follow-up"),
      el("p", { class: "hint" }, "Stuck on a line? Ask here. Answers stay on this lesson."), log, cst,
      el("form", { class: "ask", onsubmit: async e => {
        e.preventDefault();
        const q = inp.value.trim(); if (!q) return;
        inp.value = ""; send.disabled = true;
        log.append(el("div", { class: "bubble me" }, q));
        const bub = el("div", { class: "bubble ai reading" }); log.append(bub);
        status(cst, "Thinking…", "busy");
        turns.push({ role: "user", content: q });
        try {
          const text = await apiStream({ task: "chat", item, lesson: curText.slice(0, 8000), turns, profile: profileBlock() },
            t => { status(cst, ""); bub.innerHTML = md(t); });
          turns.push({ role: "assistant", content: text });
          if (turns.length > 12) turns = turns.slice(-12);
        } catch (err) {
          if (err.text) bub.innerHTML = md(err.text); else bub.remove();
          turns.pop();
          status(cst, err.message, "err");
        } finally { send.disabled = false; }
      } }, inp, send));
  }

  (async () => {
    status(st, "Opening lesson…", "busy");
    const note = await db.getNote(item.id);
    if (note) { curText = note; reading.innerHTML = md(note); status(st, ""); drawActions(); }
    else explain(false);
  })();
}

/* ================= glossary ================= */
function renderGlossary() {
  const all = Object.values(S.glossary).sort((a, b) => a.term.localeCompare(b.term));
  const v = el("section", { class: "view" }, el("h1", { class: "page" }, "Glossary"),
    el("p", { class: "lead" }, all.length ? all.length + " terms you've collected, in plain English." : "Terms you save from lessons appear here. Open any lesson and tap Save key terms."));
  if (all.length) {
    const list = el("div", {});
    const draw = q => {
      q = (q || "").toLowerCase();
      const f = all.filter(t => !q || t.term.toLowerCase().includes(q) || (t.meaning || "").toLowerCase().includes(q));
      list.replaceChildren(...(f.length ? f.map(t => el("div", { class: "term" }, el("h3", {}, t.term), el("p", {}, t.meaning),
        t.example ? el("p", { class: "ex" }, t.example) : null, el("p", { class: "from" }, "From: " + t.source))) : [el("p", { class: "hint" }, "No terms match that search.")]));
    };
    const inp = el("input", { type: "search", class: "field", placeholder: "Search terms", "aria-label": "Search terms", oninput: () => draw(inp.value) });
    v.append(el("div", { class: "ask" }, inp), list);
    draw("");
  }
  main.replaceChildren(v);
}

/* ================= progress + settings ================= */
function renderProgress() {
  const learned = Object.values(S.learned);
  const qz = S.quizzes;
  const avg = qz.length ? Math.round(100 * qz.reduce((s, q) => s + q.score / q.total, 0) / qz.length) : null;
  const weak = new Set((S.profile && S.profile.weak) || []);
  const v = el("section", { class: "view" },
    el("h1", { class: "page" }, "Your progress"),
    el("p", { class: "lead" }, "Marks from your tests, grouped by area, so you can see where to push next."),
    el("div", { class: "stats" },
      el("div", { class: "stat" }, el("b", {}, String(learned.length)), el("span", {}, "topics learned")),
      el("div", { class: "stat" }, el("b", {}, String(qz.length)), el("span", {}, "tests taken")),
      el("div", { class: "stat" }, el("b", {}, avg == null ? "–" : avg + "%"), el("span", {}, "average mark"))),
    el("h2", { class: "sec" }, "By area"));
  for (const a of AREAS) {
    const qa = qz.filter(q => q.area === a);
    const la = learned.filter(x => x.area === a).length;
    const pct = qa.length ? Math.round(100 * qa.reduce((s, q) => s + q.score / q.total, 0) / qa.length) : 0;
    v.append(el("div", { class: "area-row" }, el("span", {}, a + (weak.has(a) ? " (focus area)" : "")),
      el("span", { class: "area-num" }, la + " learned" + (qa.length ? ", avg " + pct + "%" : "")),
      el("div", { class: "bar" }, el("i", { style: "width:" + pct + "%" }))));
  }
  if (qz.length) {
    v.append(el("h2", { class: "sec" }, "Recent tests"));
    qz.slice(0, 15).forEach(q => v.append(el("div", { class: "hist" }, el("div", { class: "grade sm" }, q.score + "/" + q.total),
      el("div", {}, el("p", {}, q.item.title), el("p", { class: "hint small" }, shortDate(q.date) + ", " + q.area)))));
  }
  v.append(el("h2", { class: "sec" }, "Settings"), notifySetting(), installSetting());
  const p = S.profile || {};
  v.append(el("div", { class: "setting" }, el("h3", {}, "About you"),
    el("p", { class: "hint" }, (p.role || "") + ", " + (p.exp || "") + ". Goal: " + (p.goal || "") + ". Focus areas: " + ((p.weak || []).join(", ") || "none set") + "."),
    el("div", { class: "row" }, el("button", { class: "btn ghost", type: "button", onclick: () => show("onboard") }, "Edit my profile"),
      el("button", { class: "link", type: "button", onclick: () => sb.auth.signOut() }, "Sign out"))));
  main.replaceChildren(v);
}

function b64ToBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function notifySetting() {
  const st = el("p", { class: "status" });
  const box = el("div", { class: "setting" }, el("h3", {}, "Daily notifications"),
    el("p", { class: "hint" }, "Get a morning alert with your picks and new papers in your focus areas."));
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) { box.append(el("p", { class: "hint" }, "This browser can't show notifications. Install the app from Chrome on Android to get them.")); return box; }
  if (!cfg.vapidPublicKey) { box.append(el("p", { class: "hint" }, "Notifications aren't set up on the server yet (VAPID keys missing).")); return box; }
  const on = el("button", { class: "btn", type: "button" }, "Turn on notifications");
  const test = el("button", { class: "btn ghost", type: "button" }, "Send a test");
  on.onclick = async () => {
    on.disabled = true; status(st, "Asking for permission…", "busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notifications are blocked. Allow them for this app in your phone settings, then try again.");
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.vapidPublicKey) });
      const ok = await write(sb.from("push_subs").upsert({ endpoint: sub.endpoint, user_id: user.id, sub: sub.toJSON() }));
      if (!ok) throw new Error("Couldn't save this device.");
      status(st, "Notifications are on for this device.");
      on.textContent = "Notifications on ✓";
    } catch (e) { on.disabled = false; status(st, e.message, "err"); }
  };
  test.onclick = async () => {
    test.disabled = true; status(st, "Sending…", "busy");
    try {
      const r = await fetch("/api/push-test", { method: "POST", headers: { authorization: "Bearer " + (await token()) } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || "Test failed.");
      status(st, d.sent ? "Sent. It should appear in a few seconds." : "No devices found. Tap Turn on notifications first.");
    } catch (e) { status(st, e.message, "err"); }
    finally { test.disabled = false; }
  };
  (async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (Notification.permission === "granted" && await reg.pushManager.getSubscription()) { on.textContent = "Notifications on ✓"; }
    } catch (e) { /* ignore */ }
  })();
  box.append(el("div", { class: "row" }, on, test), st);
  return box;
}
let installPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; });
function installSetting() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const box = el("div", { class: "setting" }, el("h3", {}, "Install the app"));
  if (standalone) { box.append(el("p", { class: "hint" }, "You're using the installed app.")); return box; }
  box.append(el("p", { class: "hint" }, installPrompt ? "Add Study Desk to your home screen like a normal app." : "In Chrome, open the ⋮ menu and tap Install app (or Add to Home screen)."));
  if (installPrompt) box.append(el("div", { class: "row" }, el("button", { class: "btn ghost", type: "button", onclick: async () => {
    installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; show("progress");
  } }, "Install now")));
  return box;
}

/* ================= onboarding ================= */
function chipSet(options, selected) {
  return el("div", { class: "chips" }, options.map(o => {
    const b = el("button", { type: "button", class: "chip", "aria-pressed": selected.has(o) ? "true" : "false", onclick: () => {
      if (selected.has(o)) selected.delete(o); else selected.add(o);
      b.setAttribute("aria-pressed", selected.has(o) ? "true" : "false");
    } }, o);
    return b;
  }));
}
function selectField(opts, val, label) {
  const s = el("select", { class: "field", "aria-label": label });
  opts.forEach(o => s.append(el("option", { value: o, selected: o === val ? true : null }, o)));
  return s;
}
function renderOnboard() {
  const editing = !!S.profile;
  const p = S.profile || { name: "", role: "AI/ML Engineer", exp: "11 months", goal: GOALS[0], strong: [], weak: ["AI system design"], time: "3–4 hours", notes: "" };
  const strong = new Set(p.strong || []), weak = new Set(p.weak || []);
  const name = el("input", { type: "text", class: "field", value: p.name || "", placeholder: "What should I call you?", "aria-label": "Name" });
  const role = el("input", { type: "text", class: "field", value: p.role || "", "aria-label": "Current role" });
  const exp = el("input", { type: "text", class: "field", value: p.exp || "", "aria-label": "Experience" });
  const goal = selectField(GOALS, p.goal, "Goal");
  const time = selectField(TIMES, p.time, "Daily study time");
  const notes = el("textarea", { class: "field", placeholder: "Your stack, what you build at work, target companies, anything that helps me pick the right topics", "aria-label": "About you" });
  notes.value = p.notes || "";
  const st = el("p", { class: "status" });
  const field = (label, node) => el("div", {}, el("label", {}, label), node);
  const save = el("button", { class: "btn", type: "button", onclick: async () => {
    const np = { name: name.value.trim().slice(0, 40), role: role.value.trim().slice(0, 80) || "AI/ML Engineer", exp: exp.value.trim().slice(0, 40),
      goal: goal.value, time: time.value, strong: AREAS.filter(a => strong.has(a)), weak: AREAS.filter(a => weak.has(a)), notes: notes.value.trim().slice(0, 1500) };
    if (!np.weak.length) { status(st, "Pick at least one area you want to improve.", "err"); return; }
    save.disabled = true;
    if (await db.saveProfile(np)) {
      const changed = JSON.stringify(np) !== JSON.stringify(S.profile);
      S.profile = np;
      if (changed && editing && S.recs) S.recs = Object.assign({}, S.recs, { day: "earlier" });
      recsTried = false;
      show("home");
    } else save.disabled = false;
  } }, editing ? "Save changes" : "Start studying");
  main.replaceChildren(el("section", { class: "view" },
    el("h1", { class: "page" }, editing ? "Your profile" : "Let's set up your desk"),
    el("p", { class: "lead" }, "Tell me where you stand. Every pick, lesson and test is shaped by this."),
    el("div", { class: "form-grid" },
      field("Name", name), field("Current role", role), field("Experience", exp), field("Main goal", goal), field("Time you can study each day", time),
      el("div", {}, el("label", {}, "Areas you want to improve"), el("p", { class: "hint small" }, "These get the most attention in your daily picks."), chipSet(AREAS, weak)),
      el("div", {}, el("label", {}, "Areas you're already strong in"), chipSet(AREAS, strong)),
      field("Anything else about you", notes)),
    st, el("div", { class: "row" }, save, editing ? el("button", { class: "link", type: "button", onclick: () => show("progress") }, "Cancel") : null)));
}

/* ================= start ================= */
async function afterSignIn() {
  if (recovering) return show("reset");
  main.replaceChildren(el("p", { class: "status" }, el("span", { class: "pulse" }), "Loading your desk…"));
  try { await loadAll(); }
  catch (e) {
    main.replaceChildren(el("section", { class: "view" }, el("h1", { class: "page" }, "Couldn't load your data"),
      el("p", { class: "lead" }, e.message + ". If you just set up the app, check that you ran supabase/schema.sql."),
      el("button", { class: "btn", type: "button", onclick: afterSignIn }, "Try again")));
    return;
  }
  if (!S.profile) return show("onboard");
  const hash = location.hash.replace("#", "");
  show(["home", "new", "explore", "glossary", "progress"].includes(hash) ? hash : "home");
}
function fatal(title, msg) {
  main.replaceChildren(el("section", { class: "view" }, el("h1", { class: "page" }, title), el("p", { class: "lead" }, msg)));
}
async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(e => console.warn("SW", e));
  try { cfg = await (await fetch("/api/config", { cache: "no-store" })).json(); }
  catch (e) { return fatal("Can't reach the server", "Check your internet connection and reopen the app."); }
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return fatal("Setup isn't finished", "Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel settings, then redeploy.");
  if (!window.supabase) return fatal("Couldn't load", "A required script didn't load. Check your connection and reopen the app.");
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  let started = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { recovering = true; user = session.user; started = true; show("reset"); return; }
    if (event === "SIGNED_OUT") { user = null; started = false; Object.assign(S, { profile: null, recs: null, learned: {}, quizzes: [], glossary: {}, paths: [], papers: [] }); show("auth"); return; }
    if (session && !started) { started = true; user = session.user; setTimeout(afterSignIn, 0); }
  });
  const { data } = await sb.auth.getSession();
  if (!data.session && !started) show("auth");
}
boot();
})();
