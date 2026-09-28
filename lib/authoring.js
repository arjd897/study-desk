// Prompts for authoring the shared knowledge base.
//
// Every level is written once and read by every learner, so these prompts can
// afford to be demanding. Depth is the whole point: L0 is the only level
// allowed to be comfortable.

export const LEVELS = {
  0: { name: "Intuition",   kind: "prose" },
  1: { name: "Mechanism",   kind: "prose" },
  2: { name: "The paper",   kind: "prose" },
  3: { name: "Build it",    kind: "exercise" },
  4: { name: "Critique",    kind: "prose" },
  5: { name: "Design",      kind: "prose" }
};

const MAX_SOURCE_CHARS = 12000;

/* ---------------- choosing which paper text to ground on ---------------- */

// Sections are picked by the section numbers named in the curriculum note
// ("Section 3.2 defines..."), then padded with the introduction and abstract.
// Never send the whole paper: it wastes context and buries the relevant part.
export function selectSources(papers) {
  const chosen = [];
  let budget = MAX_SOURCE_CHARS;

  for (const p of papers) {
    if (!p.sections || !p.sections.length) {
      const text = (p.abstract || "").slice(0, budget);
      if (text) { chosen.push({ arxiv_id: p.arxiv_id, heading: "Abstract", text }); budget -= text.length; }
      continue;
    }
    const wanted = (p.note || "").match(/\d+(?:\.\d+)*/g) || [];
    const score = (s) => {
      const num = (s.heading.match(/^\d+(?:\.\d+)*/) || [""])[0];
      if (num && wanted.some(w => num === w || num.startsWith(w + "."))) return 3;
      if (/^\d*\.?\s*(introduction|abstract)/i.test(s.heading)) return 2;
      if (/conclusion|discussion|limitation/i.test(s.heading)) return 1;
      return 0;
    };
    const ranked = [...p.sections].map((s, i) => ({ s, i, r: score(s) }))
      .sort((a, b) => b.r - a.r || a.i - b.i);

    for (const { s, r } of ranked) {
      if (budget <= 500) break;
      if (r === 0 && chosen.length > 2) continue;         // only fill with unranked text if we are short
      const text = s.text.slice(0, Math.min(4000, budget));
      chosen.push({ arxiv_id: p.arxiv_id, heading: s.heading, text });
      budget -= text.length;
    }
  }
  return chosen;
}

const sourceBlock = (sources) => sources.length
  ? "\n\nPAPER TEXT YOU MUST GROUND IN. Quote and cite these; do not rely on memory:\n\n" +
    sources.map(s => `--- arXiv:${s.arxiv_id} | ${s.heading} ---\n${s.text}`).join("\n\n")
  : "";

/* ---------------- the prompts ---------------- */

const VOICE = `
Write for someone who can program but has no machine learning background.
Rules:
- Plain English. No hype, no "delve", no "in today's fast-paced world".
- Define every symbol the first time it appears.
- Prefer a concrete number or worked example over an adjective.
- Never say something is "simple", "just" or "obvious".
- Markdown. Use ## headings, short paragraphs, and LaTeX between $ for maths.
- Do not open by restating the title or announcing what you will cover.`;

const context = (c, prereqTitles) => `
CONCEPT: ${c.title}
ONE LINE: ${c.blurb}
AREA: ${c.area}
THE LEARNER ALREADY KNOWS: ${prereqTitles.length ? prereqTitles.join(", ") : "programming, and nothing about this area yet"}
They have NOT yet learned anything that comes after this concept, so do not depend on it.`;

export function levelPrompt(level, c, prereqTitles, sources) {
  const head = context(c, prereqTitles) + VOICE;
  const grounded = sourceBlock(sources);
  const hasPapers = sources.length > 0;

  switch (level) {
    case 0:
      return `${head}

Write the INTUITION level (about 400 words).
Answer, in this order:
1. What problem existed before this idea, stated concretely enough that the reader feels it.
2. The core idea, in two or three sentences, with one analogy that does not break under pressure.
3. One small worked example with real numbers.
4. What this does NOT solve.

No maths beyond arithmetic. This is the only level allowed to be comfortable.`;

    case 1:
      return `${head}

Write the MECHANISM level (about 800 words).
Requirements:
- Give the precise definition, with every symbol and its shape.
- DERIVE the key result step by step. Do not state it and move on.
- Work one numeric example end to end with small concrete numbers, showing intermediate values.
- State the computational and memory cost in big-O, and say what each term means physically.
- End with "Where this breaks": the assumptions, and what happens when they fail.`;

    case 2:
      return hasPapers ? `${head}${grounded}

Write THE PAPER level (about 900 words): a guided read of the paper above.
Requirements:
- What exactly did the authors claim, in their terms.
- The key equation or algorithm AS THE PAPER STATES IT, then translated into plain language.
- The experiment that supports the claim: setup, the specific numbers reported, and what the comparison was against.
- What the ablations reveal about which part actually matters.
- What the paper does NOT show, and which claims are weaker than they are usually quoted as.
- Cite as (arXiv:ID, Section N) whenever you use the source text. Every number you give must come from the text above, not from memory. If the text does not contain something, say so rather than filling it in.` : `${head}

Write the DEEPER TREATMENT level (about 700 words).
There is no single canonical paper for this concept, so instead:
- Work through two contrasting examples in full detail.
- Show the most common misconception and exactly why it is wrong, with a counterexample.
- Give the edge cases that break naive implementations, including numerical ones.`;

    case 3:
      return `${head}${grounded}

Write the BUILD IT level as JSON only:
{
  "brief": "markdown: what to implement, the exact function signature, the input and expected output, and 2-3 test cases with concrete numbers the learner can check against",
  "reference": "markdown: a clean reference implementation in Python with numpy or pure torch, under 60 lines, commented where the reasoning is not obvious",
  "rubric": ["4-6 specific things a correct solution must do, each independently checkable, e.g. 'subtracts the row max before exponentiating' - not vague items like 'code is correct'"]
}
The task must be small enough to finish in 30 minutes and must force understanding of the mechanism, not just API calls. No training loops, no downloading models, no GPU.`;

    case 4:
      return `${head}${grounded}

Write the CRITIQUE level (about 700 words).
Requirements:
- What this approach gets wrong, or where it stops working. Be specific about the regime.
- What it cost: the trade-off that is usually left out of summaries.
- What came after it and why. Name the successor ideas and what each fixed.
- What is still open or contested.
- One claim about this topic that is widely repeated and is actually wrong or oversimplified.
Do not be diplomatic. If something was superseded, say so plainly.`;

    case 5:
      return `${head}

Write the DESIGN level (about 700 words).
Requirements:
- A realistic scenario with hard numbers: traffic, latency target, hardware, budget.
- Walk through the decision, showing the arithmetic. Actually compute the memory or throughput.
- Give the alternative you rejected and the specific condition under which you would choose it instead.
- The failure mode of your own choice, and what you would monitor to catch it.
- End with two interview-grade questions on this, and what a strong answer must contain.`;

    default:
      throw new Error("no prompt for level " + level);
  }
}
