// Assessment: the one thing that cannot be pre-generated, because it depends
// on what this particular learner wrote.
//
// Multiple choice cannot measure depth, so every level is assessed by an open
// response marked against a rubric. The grader is told to be strict, because a
// grader that passes everyone is worse than no grader at all.

export const KINDS = {
  0: "recall",    // did you follow the idea
  1: "derive",    // can you reproduce the reasoning
  2: "paper",     // did you understand what the paper actually claims
  3: "code",      // can you implement it
  4: "critique",  // do you know where it breaks
  5: "design"     // can you use it under constraints
};

const cut = (s, n) => String(s || "").slice(0, n);

/* ---------------- asking ---------------- */

export function questionPrompt(concept, level, body, previous = []) {
  const avoid = previous.length
    ? `\n\nDo NOT repeat these questions already asked of this learner:\n${previous.map(q => "- " + cut(q, 160)).join("\n")}`
    : "";

  const brief = {
    0: "Ask ONE question that checks they followed the core idea and can restate it in their own words with a concrete example. Not a definition they could copy back.",
    1: "Ask ONE question that requires them to DERIVE or compute something. They must show steps. Include any numbers they need.",
    2: "Ask ONE question about what the paper actually claims, its evidence, or its limits. It must be unanswerable from the abstract alone.",
    3: "Skip: level 3 is graded from submitted code.",
    4: "Ask ONE question that requires them to identify a failure mode, a trade-off, or something commonly believed about this that is wrong.",
    5: "Give ONE short scenario with concrete numbers and ask them to make a design decision and justify it with arithmetic."
  }[level];

  return `You are setting one exam question for a learner studying: ${concept.title}.

THE MATERIAL THEY STUDIED:
"""
${cut(body, 6000)}
"""

${brief}${avoid}

Return JSON only:
{
  "question": "the question, in markdown, self-contained, including any numbers or code they need",
  "expects": ["3-5 specific things a full-credit answer must contain, each independently checkable"]
}
Ask something answerable in 3-8 sentences. Do not ask them to write an essay.`;
}

/* ---------------- marking ---------------- */

export function gradePrompt(concept, level, question, expects, answer) {
  return `You are marking one answer from a learner studying: ${concept.title} (depth level ${level}, ${KINDS[level]}).

QUESTION ASKED:
"""
${cut(question, 3000)}
"""

WHAT A FULL ANSWER MUST CONTAIN:
${expects.map((e, i) => `${i + 1}. ${e}`).join("\n")}

THEIR ANSWER:
"""
${cut(answer, 6000)}
"""

Mark it honestly. Be strict: a confident answer that is wrong scores lower than
an uncertain answer that is right. Do not give credit for restating the question,
for vague gestures at the right area, or for correct-sounding jargon used wrongly.

Return JSON only:
{
  "score": 0.0 to 1.0,
  "hits": ["which required points they actually made"],
  "misses": ["which required points they missed or got wrong"],
  "feedback": "markdown, 3-5 sentences, addressed to them as 'you'. Name the single most important thing to fix, and explain the correct reasoning for it. If they were right, say what was strong and push them one step further.",
  "verdict": "pass" or "retry"
}
Score 0.8+ only when every required point is present and correct. Use "pass" at 0.7 or above.`;
}

export function codeGradePrompt(concept, brief, reference, rubric, code) {
  return `You are reviewing a learner's implementation for: ${concept.title}.

THE TASK THEY WERE GIVEN:
"""
${cut(brief, 3000)}
"""

A CORRECT REFERENCE SOLUTION:
"""
${cut(reference, 3000)}
"""

RUBRIC - each item must be independently checked:
${rubric.map((r, i) => `${i + 1}. ${r}`).join("\n")}

THEIR SUBMISSION:
"""
${cut(code, 6000)}
"""

Trace their code by hand against the test cases in the task. Do not assume it
works because it looks plausible. Their approach may differ from the reference
and still be correct: mark the behaviour, not the style.

Return JSON only:
{
  "score": 0.0 to 1.0,
  "rubric_results": [{ "item": "the rubric item", "met": true or false, "why": "one sentence of evidence from their code" }],
  "bug": "the single most important defect, with the input that triggers it and what it would produce - or empty string if none",
  "feedback": "markdown, 3-5 sentences addressed as 'you'. If it is correct, say what to improve next. If not, point at the line and explain the reasoning, do not just give the fix.",
  "verdict": "pass" or "retry"
}
Every rubric item must appear in rubric_results. Use "pass" only when the code
would actually produce the expected output for every test case given.`;
}

/* ---------------- spaced repetition ---------------- */

// Expanding intervals on success, back to the start on failure. Deliberately
// simple: the schedule matters far less than the fact that review happens.
const DAYS = [1, 3, 7, 16, 35, 70];

export function nextReview(streak, passed) {
  const s = passed ? Math.min(streak + 1, DAYS.length - 1) : 0;
  const d = new Date();
  d.setDate(d.getDate() + DAYS[s]);
  return { streak: s, due_at: d.toISOString().slice(0, 10) };
}
