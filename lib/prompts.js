// All AI prompts live here, on the server, so users can't tamper with them.

export const AREAS = [
  "LLM internals", "Training & scaling", "Fine-tuning & alignment", "Reasoning models",
  "Inference & serving", "RAG & search", "Agents & tools", "AI system design",
  "Evals & monitoring", "MLOps & deployment", "Multimodal & diffusion", "ML & math foundations"
];
export const KINDS = ["paper", "concept", "system-design", "trend"];

export const STYLE =
  "Write in very simple, clear English for a reader whose first language is not English: short sentences, everyday words, " +
  "and explain every technical term the first time you use it. Use one concrete everyday analogy. Stay technically correct " +
  "and precise; simple must not mean vague. Use Markdown with ## headings, short paragraphs and bullet lists. " +
  "Put math, pseudo-code and diagrams in fenced code blocks.";

export const ITEM_SHAPE =
  '{"title":"...","kind":"paper|concept|system-design|trend","detail":"for papers: authors and year; otherwise a short scope",' +
  '"arxiv":"arXiv id like 1706.03762 only if you are certain, else empty string","area":"one allowed area",' +
  '"level":"beginner|intermediate|advanced","minutes":30,"why":"one simple sentence on why this matters for this learner"}';

export function today() { return new Date().toISOString().slice(0, 10); }

export function slug(t) {
  const s = String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return s || "item-" + Date.now().toString(36);
}

export function normItem(x) {
  x = x || {};
  const title = String(x.title || "Untitled").trim().slice(0, 200);
  const ax = String(x.arxiv || "").trim().replace(/^arxiv:\s*/i, "");
  return {
    id: slug(title),
    title,
    kind: KINDS.includes(x.kind) ? x.kind : "concept",
    detail: String(x.detail || "").slice(0, 300),
    arxiv: /^\d{4}\.\d{4,5}$/.test(ax) ? ax : "",
    area: AREAS.includes(x.area) ? x.area : "LLM internals",
    level: ["beginner", "intermediate", "advanced"].includes(String(x.level)) ? String(x.level) : "intermediate",
    minutes: Math.max(5, Math.min(240, Number(x.minutes) || 30)),
    why: String(x.why || "").slice(0, 400)
  };
}

export function recsPrompt(profile, day, newPapers = []) {
  const papers = newPapers.length
    ? "\n\nNEW PAPERS FROM THE LAST FEW DAYS (real, verified arXiv ids):\n" +
      newPapers.slice(0, 15).map(p => `- ${p.id} | ${p.title} | ${p.area || ""}`).join("\n") +
      "\nFor the 'recent development' slot, prefer one of these new papers if it truly matters for this learner " +
      "(use kind 'paper' and its exact arXiv id). You may include at most 2 of them in total."
    : "";
  return (
    "You are a senior AI/ML engineering mentor preparing a learner for senior and lead AI/ML engineer roles and interviews.\n\n" +
    profile + "\n\nToday is " + day + ".\n" +
    "Recommend exactly 6 things to study today. Mix them like this: two deep concepts from their weak areas; one landmark or " +
    "important research paper; one AI system design drill (a realistic AI product to design, for example 'Design a RAG assistant " +
    "over 10 million documents'); one important recent development; and one review item, picked from topics with low quiz marks " +
    "if there are any, otherwise another high-value topic. Never repeat anything listed under Recently learned. Order them in the " +
    "best study sequence.\nAllowed areas: " + AREAS.join(" | ") + papers + "\n\n" +
    'Reply with only JSON in this shape:\n{"focus":"one simple sentence describing today\'s theme","items":[' + ITEM_SHAPE + "]}"
  );
}

export function pathPrompt(profile, topic) {
  return (
    'You are a senior AI/ML mentor. Build a progressive study path for the topic: "' + topic + '".\n\n' + profile + "\n\n" +
    "Go from foundations to advanced to the current frontier in 7 to 10 steps, in the order they should be studied. Include the " +
    "landmark research papers for this topic (with correct authors and year) and the key concepts that connect them. If the topic " +
    "is applied (apps, products, infrastructure), include at least one system-design step. Skip basics this learner clearly " +
    "already knows.\nAllowed areas: " + AREAS.join(" | ") + "\n\n" +
    'Reply with only JSON in this shape:\n{"topic":"clean topic name","overview":"two simple sentences on what this path covers ' +
    'and why it matters for this learner","steps":[' + ITEM_SHAPE + "]}"
  );
}

export function explainPrompt(profile, item, fresh) {
  const head = {
    "paper":
      'Explain this research paper: "' + item.title + '" (' + item.detail + (item.arxiv ? ", arXiv " + item.arxiv : "") + ").\n" +
      "Use exactly these sections:\n## In one line\n## The problem before this paper\n## The big idea (with an everyday analogy)\n" +
      "## How it works, step by step\n(include the key equation or pseudo-code in a code block if there is one, and explain every symbol)\n" +
      "## Results and why it mattered\n## Limitations and what came after\n## Key terms\n(bullet list: **term**: simple meaning)\n" +
      "## Interview questions\n(3 questions a senior or lead interviewer would ask, each followed by a short strong answer)\n" +
      "## Read next\n(2 or 3 follow-up papers or topics, one line each on why)\n" +
      "If you are unsure about a specific number or detail, say so instead of guessing.",
    "concept":
      'Teach this concept: "' + item.title + '" (' + item.detail + ").\nUse exactly these sections:\n## In one line\n" +
      "## Why it exists (the problem it solves)\n## The idea, with an everyday analogy\n## How it works, step by step\n" +
      "(include a tiny worked example with real numbers, or short PyTorch-style code, in a code block)\n" +
      "## Where it is used in real systems\n## Common mistakes and misconceptions\n## Key terms\n(bullet list: **term**: simple meaning)\n" +
      "## Interview questions\n(3 questions a senior or lead interviewer would ask, each followed by a short strong answer)\n" +
      "## Read next\n(the landmark papers or topics to read after this, one line each)",
    "system-design":
      'Teach this AI system design problem the way a senior engineer would answer it in an interview: "' + item.title + '" (' + item.detail + ").\n" +
      "Use exactly these sections:\n## The problem and requirements\n(functional and non-functional, with rough numbers for users, QPS, latency and data size)\n" +
      "## High-level architecture\n(draw an ASCII box-and-arrow diagram in a code block, then explain each component in one or two lines)\n" +
      "## How one request flows, step by step\n## Data, indexing and model choices\n## Key decisions and trade-offs\n" +
      "(a Markdown table with columns: Decision | Options | What to pick and why)\n## Scaling, latency and cost\n(simple back-of-the-envelope estimates)\n" +
      "## Failure modes and guardrails\n## How to evaluate and monitor it\n## Interview follow-up questions\n(4 questions, each with a short strong answer)\n" +
      "## Key terms\n(bullet list: **term**: simple meaning)",
    "trend":
      'Explain this development in AI: "' + item.title + '" (' + item.detail + ").\n" +
      "Start with one short sentence noting this is based on your training knowledge, so the learner should check for newer updates.\n" +
      "Then use exactly these sections:\n## In one line\n## What it is\n## Why people care about it now\n## How it works, simply\n" +
      "## Who uses it and where\n## Limits and open debates\n## Key terms\n(bullet list: **term**: simple meaning)\n" +
      "## Interview questions\n(2 questions with short strong answers)\n## Read next"
  }[item.kind];
  return head + "\n\n" + STYLE + "\n\n" + profile +
    "\n\nTailor examples to this learner's goal. Aim for about 900 to 1300 words." +
    (fresh ? "\n\nThe learner asked for a fresh explanation: use a different analogy and different examples than usual." : "");
}

export function quizPrompt(item, lesson) {
  return (
    'Create a 5-question multiple-choice quiz that tests real understanding of "' + item.title + '" at the level of a senior ' +
    "AI/ML engineer interview. Base it on the lesson below, but test understanding, not memory of its wording. Mix: 2 conceptual, " +
    "2 applied or scenario questions, and 1 about a common misconception. Each question has exactly 4 options and exactly one " +
    'correct option. Use simple English.\n\nLesson:\n"""\n' + lesson + '\n"""\n\n' +
    'Reply with only JSON in this shape:\n{"questions":[{"q":"...","options":["...","...","...","..."],"answer":0,' +
    '"why":"one or two simple sentences explaining the correct answer"}]}'
  );
}

export function termsPrompt(item, lesson) {
  return (
    'From this lesson about "' + item.title + '", pick up to 8 key technical terms a learner must know. For each, give a ' +
    "one-sentence meaning in very simple English and one short concrete example.\n\nLesson:\n\"\"\"\n" + lesson + '\n"""\n\n' +
    'Reply with only JSON in this shape:\n{"terms":[{"term":"...","meaning":"...","example":"..."}]}'
  );
}

export function chatRules(profile, item, lesson) {
  return (
    'You are a patient AI/ML teacher. The learner is studying "' + (item ? item.title : "a topic") + '". Here is the lesson ' +
    'they just read:\n"""\n' + lesson + '\n"""\n' + STYLE + "\nAnswer their questions in under 250 words unless they ask for more.\n\n" + profile
  );
}

export function papersDigestPrompt(papers) {
  return (
    "You explain new AI research papers to a working AI/ML engineer in very simple English.\n" +
    "For each paper below, write:\n- simple: 2 or 3 short sentences on what the paper does and its main result, in everyday words\n" +
    "- why: one sentence on why an AI/ML engineer should care (or 'Mostly of research interest' if it has little practical use)\n" +
    "- area: exactly one of: " + AREAS.join(" | ") + "\n\n" +
    papers.map(p => `ID: ${p.id}\nTITLE: ${p.title}\nABSTRACT: ${p.abstract}`).join("\n\n") + "\n\n" +
    'Reply with only JSON in this shape:\n{"papers":[{"id":"...","simple":"...","why":"...","area":"..."}]}'
  );
}
