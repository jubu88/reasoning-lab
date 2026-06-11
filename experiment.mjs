// Refinement-loop experiment: baseline vs iterated accuracy, headless.
//
// For each problem: attempt 0 (baseline), then N revision rounds where the model
// gets a FRESH context with the problem + its previous attempt and must revise.
// All rounds always run (fixed schedule); we then score three policies offline:
//   baseline  – attempt 0
//   converged – first answer that repeats in consecutive rounds (honest early-stop)
//   final     – answer after the last round
//
// Usage:
//   node experiment.mjs --model gemma4:latest --style direct --rounds 4 \
//     --set classic|hard|all --only id1,id2 --feedback full|answer --out experiment-results.json

import {
  ALL_PROBLEMS, BATTERY_CLASSIC, BATTERY_HARD,
  ask, checkAnswer, extractFinal, instructionFor, normalizeAnswer,
} from "./battery.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const MODEL = args.model ?? "gemma4:latest";
const STYLE = args.style ?? "direct";
const REV_STYLE = args.revisionStyle ?? STYLE; // escalate revisions to free-form with --revisionStyle free
const THINK = (args.think ?? "false") === "true";
const ROUNDS = Number(args.rounds ?? 4);
const BASE_TEMP = Number(args.temp ?? 0);
const REV_TEMP = Number(args.revisionTemp ?? BASE_TEMP); // jitter revisions with --revisionTemp 0.8
const FEEDBACK = args.feedback ?? "full"; // full | answer
const FRAMING = args.framing ?? "self"; // self ("your previous attempt") | student (de-anchored third-person)
const SET = args.set ?? "classic";
const ONLY = args.only ? args.only.split(",").map((s) => s.trim()) : null;
const OUT = args.out ?? "experiment-results.json";

let problems = SET === "hard" ? BATTERY_HARD : SET === "all" ? ALL_PROBLEMS : BATTERY_CLASSIC;
if (ONLY) problems = problems.filter((p) => ONLY.includes(p.id));

function revisionPrompt(problemPrompt, prevContent, prevExtracted) {
  const prevText =
    FEEDBACK === "full"
      ? prevContent.length > 4000 ? prevContent.slice(0, 4000) + "\n[...truncated]" : prevContent
      : `FINAL: ${prevExtracted}`;
  if (FRAMING === "student") {
    return (
      "You are grading another student's attempt at a problem. Students often fall for trick questions, so their answer may well be wrong.\n\n" +
      `PROBLEM:\n${problemPrompt}\n\n` +
      `THE STUDENT'S ATTEMPT:\n${prevText}\n\n` +
      "INSTRUCTIONS:\n" +
      "1. Read the problem very carefully yourself. Watch for traps, irrelevant details, and wording tricks.\n" +
      "2. Solve the problem completely from scratch, ignoring the student's answer while you work.\n" +
      "3. Only then compare with the student's attempt and decide which answer is actually right.\n" +
      "4. State the correct final answer." +
      instructionFor(REV_STYLE)
    );
  }
  return (
    "You previously attempted to solve a problem. Your job now is to carefully review that attempt and produce a final answer.\n\n" +
    `PROBLEM:\n${problemPrompt}\n\n` +
    `YOUR PREVIOUS ATTEMPT:\n${prevText}\n\n` +
    "INSTRUCTIONS:\n" +
    "1. Re-read the problem very carefully. Watch for traps, irrelevant details, and wording tricks.\n" +
    "2. Solve the problem yourself from scratch.\n" +
    "3. Compare your result with the previous attempt. If they differ, work out which one is actually right.\n" +
    "4. State your final answer." +
    instructionFor(REV_STYLE)
  );
}

console.log(
  `Experiment: ${MODEL} | style=${STYLE} | revisions=${REV_STYLE}@temp${REV_TEMP} | framing=${FRAMING} | think=${THINK} | rounds=${ROUNDS} | feedback=${FEEDBACK} | set=${SET}${ONLY ? ` (only: ${ONLY.join(",")})` : ""} | ${problems.length} problems\n`
);

const out = [];
let done = 0;

for (const p of problems) {
  done++;
  const iterations = [];
  let errored = false;
  try {
    for (let i = 0; i <= ROUNDS; i++) {
      const prompt =
        i === 0
          ? p.prompt + instructionFor(STYLE)
          : revisionPrompt(p.prompt, iterations[i - 1].content, iterations[i - 1].extracted);
      const t0 = Date.now();
      const resp = await ask({
        model: MODEL,
        prompt,
        think: THINK,
        seed: 7 + i,
        temperature: i === 0 ? BASE_TEMP : REV_TEMP,
      });
      const content = resp.message?.content ?? "";
      const verdict = checkAnswer(p, content);
      iterations.push({
        index: i,
        extracted: verdict.extracted,
        correct: verdict.pass,
        seconds: (Date.now() - t0) / 1000,
        content,
      });
    }
  } catch (e) {
    errored = true;
    console.log(`ERR   ${p.id}: ${String(e).slice(0, 120)}`);
  }
  if (errored || iterations.length === 0) {
    out.push({ id: p.id, error: true });
    continue;
  }

  // converged answer: first answer equal (normalized) to the previous round's
  let convergedIdx = iterations.length - 1;
  for (let i = 1; i < iterations.length; i++) {
    const a = normalizeAnswer(iterations[i].extracted);
    if (a !== "" && a === normalizeAnswer(iterations[i - 1].extracted)) {
      convergedIdx = i;
      break;
    }
  }

  // majority answer across all iterations (ties broken toward the later answer)
  const counts = new Map();
  for (const it of iterations) {
    const key = normalizeAnswer(it.extracted);
    counts.set(key, { n: (counts.get(key)?.n ?? 0) + 1, correct: it.correct });
  }
  let majority = { n: 0, correct: false };
  for (const v of counts.values()) if (v.n >= majority.n) majority = v;

  const baseline = iterations[0];
  const finalIt = iterations[iterations.length - 1];
  const conv = iterations[convergedIdx];
  out.push({
    id: p.id,
    category: p.category,
    baselineCorrect: baseline.correct,
    convergedCorrect: conv.correct,
    convergedAt: convergedIdx,
    finalCorrect: finalIt.correct,
    majorityCorrect: majority.correct,
    answers: iterations.map((it) => ({ i: it.index, a: it.extracted, ok: it.correct, s: Number(it.seconds.toFixed(1)) })),
    iterations,
  });
  console.log(
    `[${done}/${problems.length}] ${p.id.padEnd(28)} baseline=${baseline.correct ? "PASS" : "FAIL"}  converged@${convergedIdx}=${conv.correct ? "PASS" : "FAIL"}  final=${finalIt.correct ? "PASS" : "FAIL"}  majority=${majority.correct ? "PASS" : "FAIL"}  answers: ${iterations.map((it) => JSON.stringify(it.extracted.slice(0, 24))).join(" -> ")}`
  );
}

const ok = out.filter((r) => !r.error);
const n = ok.length;
const sum = (f) => ok.filter(f).length;
console.log(`\n=== ${MODEL} | style=${STYLE} | revisions=${REV_STYLE}@temp${REV_TEMP} | rounds=${ROUNDS} | feedback=${FEEDBACK} ===`);
console.log(`baseline accuracy:  ${sum((r) => r.baselineCorrect)}/${n}`);
console.log(`converged accuracy: ${sum((r) => r.convergedCorrect)}/${n}  (honest early-stop)`);
console.log(`final-round accuracy: ${sum((r) => r.finalCorrect)}/${n}`);
console.log(`majority-vote accuracy: ${sum((r) => r.majorityCorrect)}/${n}`);
console.log(`fixed by iteration:  ${ok.filter((r) => !r.baselineCorrect && r.convergedCorrect).map((r) => r.id).join(", ") || "none"}`);
console.log(`broken by iteration: ${ok.filter((r) => r.baselineCorrect && !r.convergedCorrect).map((r) => r.id).join(", ") || "none"}`);

const fs = await import("node:fs");
fs.writeFileSync(
  OUT,
  JSON.stringify({ model: MODEL, style: STYLE, revisionStyle: REV_STYLE, revisionTemp: REV_TEMP, framing: FRAMING, think: THINK, rounds: ROUNDS, feedback: FEEDBACK, set: SET, when: new Date().toISOString(), results: out }, null, 2)
);
console.log(`\nWrote ${OUT}`);
