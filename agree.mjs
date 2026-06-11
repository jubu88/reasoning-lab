// Agreement-based early-stopping (sequential self-consistency):
// keep producing solution attempts until ANY two of them give the same
// (normalized) answer; that agreed answer is the output. Cap at --rounds
// attempts; no agreement = "unresolved" (a natural escalation signal).
// The SCRIPT judges agreement — the model just solves.
//
// Two context modes:
//   fresh: every attempt is independent (no prior answers visible); the script
//          varies the solving angle per round. Agreement = real evidence.
//   chat:  one growing conversation; each round asks to re-solve differently.
//          The model sees its old attempts — tests how much anchoring inflates
//          (false) agreement.
//
// Usage: node agree.mjs [--model gemma4:e4b] [--style free] [--mode fresh|chat]
//                       [--rounds 4] [--out agree-results.json]

import { BATTERY_CLASSIC, ask, checkAnswer, instructionFor, normalizeAnswer } from "./battery.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const MODEL = args.model ?? "gemma4:e4b";
const STYLE = args.style ?? "free";
const MODE = args.mode ?? "fresh"; // fresh | chat
const ROUNDS = Number(args.rounds ?? 4);
const OUT = args.out ?? `agree-${MODE}.json`;

// per-round solving angles for fresh mode — different prompts force different
// computations at temp 0 (same prompt would reproduce the same answer exactly)
const ANGLES = [
  "",
  "\n\nSolve this carefully step by step, watching for traps or tricks in the wording.",
  "\n\nSolve this using a different approach than the most obvious one.",
  "\n\nSolve this, then verify your result with a second, different method before answering.",
];

const RESOLVE_DIFFERENTLY =
  "Now re-solve the same problem using a different method or approach than before. Work it out independently, then state your answer." ;

function firstAgreement(answers) {
  // returns {idxA, idxB} of the earliest pair of matching normalized answers, or null
  for (let j = 1; j < answers.length; j++) {
    for (let i = 0; i < j; i++) {
      if (answers[i] !== "" && answers[i] === answers[j]) return { idxA: i, idxB: j };
    }
  }
  return null;
}

const results = [];
console.log(`Agreement stopping: ${MODEL} | style=${STYLE} | mode=${MODE} | max ${ROUNDS} attempts\n`);

for (const p of BATTERY_CLASSIC) {
  const attempts = [];
  let agreed = null;
  let outTokens = 0;
  try {
    const convo = []; // only used in chat mode
    for (let i = 0; i < ROUNDS; i++) {
      let resp;
      if (MODE === "chat") {
        if (i === 0) convo.push({ role: "user", content: p.prompt + instructionFor(STYLE) });
        else {
          convo.push({ role: "assistant", content: attempts[i - 1].content });
          convo.push({ role: "user", content: RESOLVE_DIFFERENTLY + instructionFor(STYLE) });
        }
        resp = await ask({ model: MODEL, messages: convo, seed: 7 + i });
      } else {
        const angle = ANGLES[i % ANGLES.length];
        resp = await ask({ model: MODEL, prompt: p.prompt + angle + instructionFor(STYLE), seed: 7 + i });
      }
      const content = resp.message?.content ?? "";
      const verdict = checkAnswer(p, content);
      outTokens += resp.eval_count ?? 0;
      attempts.push({ extracted: verdict.extracted, correct: verdict.pass, content });
      const match = firstAgreement(attempts.map((a) => normalizeAnswer(a.extracted)));
      if (match) {
        agreed = { answer: attempts[match.idxB].extracted, correct: attempts[match.idxB].correct, atRound: i + 1 };
        break;
      }
    }
  } catch (e) {
    results.push({ id: p.id, error: String(e) });
    console.log(`ERR   ${p.id}: ${String(e).slice(0, 100)}`);
    continue;
  }
  const trail = attempts.map((a) => a.extracted || "…").join(" | ");
  results.push({
    id: p.id,
    resolved: Boolean(agreed),
    correct: agreed ? agreed.correct : false,
    rounds: attempts.length,
    outTokens,
    agreedAnswer: agreed?.answer ?? null,
    attempts: attempts.map((a) => ({ extracted: a.extracted, correct: a.correct })),
  });
  console.log(
    `${agreed ? (agreed.correct ? "PASS" : "FAIL") : "UNRESOLVED"}  ${p.id.padEnd(24)} ${attempts.length} attempts  ${String(outTokens).padStart(5)} tok  [${trail.slice(0, 70)}]`
  );
}

const ok = results.filter((r) => !r.error);
const resolved = ok.filter((r) => r.resolved);
const correct = resolved.filter((r) => r.correct);
const falseAgree = resolved.filter((r) => !r.correct);
console.log(`\n=== ${MODEL} | ${MODE} mode ===`);
console.log(`resolved by agreement: ${resolved.length}/${ok.length} (avg ${(resolved.reduce((s, r) => s + r.rounds, 0) / Math.max(1, resolved.length)).toFixed(1)} attempts)`);
console.log(`correct when agreed:   ${correct.length}/${resolved.length}`);
console.log(`FALSE agreements:      ${falseAgree.length}  (${falseAgree.map((r) => r.id).join(", ") || "none"})`);
console.log(`unresolved (escalate): ${ok.length - resolved.length}  (${ok.filter((r) => !r.resolved).map((r) => r.id).join(", ") || "none"})`);
console.log(`total output tokens:   ${ok.reduce((s, r) => s + (r.outTokens ?? 0), 0)}`);

const fs = await import("node:fs");
fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, style: STYLE, mode: MODE, rounds: ROUNDS, when: new Date().toISOString(), results }, null, 2));
console.log(`Wrote ${OUT}`);
