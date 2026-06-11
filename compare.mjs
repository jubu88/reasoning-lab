// Cross-model comparison: for each model, run the classic battery one-shot in both
// answer styles, then run the winning refinement strategy (direct baseline,
// free-form revisions, honest convergence stop) on the direct-mode failures.
//
// Output per model: free-form accuracy, direct accuracy, pipeline accuracy
// (direct + refinement loop), and speed (tokens/sec, seconds per problem).
//
// Usage: node compare.mjs --models gemma4:e2b,gemma4:e4b [--rounds 3] [--out compare-results.json]

import {
  BATTERY_CLASSIC,
  ask,
  checkAnswer,
  instructionFor,
  normalizeAnswer,
} from "./battery.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const MODELS = (args.models ?? "gemma4:e2b,gemma4:e4b").split(",").map((s) => s.trim());
const ROUNDS = Number(args.rounds ?? 3);
const OUT = args.out ?? "compare-results.json";

function revisionPrompt(problemPrompt, prevContent) {
  const prevText = prevContent.length > 4000 ? prevContent.slice(0, 4000) + "\n[...truncated]" : prevContent;
  return (
    "You previously attempted to solve a problem. Your job now is to carefully review that attempt and produce a final answer.\n\n" +
    `PROBLEM:\n${problemPrompt}\n\n` +
    `YOUR PREVIOUS ATTEMPT:\n${prevText}\n\n` +
    "INSTRUCTIONS:\n" +
    "1. Re-read the problem very carefully. Watch for traps, irrelevant details, and wording tricks.\n" +
    "2. Solve the problem yourself from scratch.\n" +
    "3. Compare your result with the previous attempt. If they differ, work out which one is actually right.\n" +
    "4. State your final answer." +
    instructionFor("free")
  );
}

function speedStats(rows) {
  const toks = rows.filter((r) => r.tokPerSec);
  return {
    avgTokPerSec: toks.length ? Number((toks.reduce((s, r) => s + r.tokPerSec, 0) / toks.length).toFixed(1)) : null,
    avgSeconds: Number((rows.reduce((s, r) => s + r.seconds, 0) / rows.length).toFixed(1)),
  };
}

async function probeOnce(model, style) {
  const rows = [];
  for (const p of BATTERY_CLASSIC) {
    const t0 = Date.now();
    try {
      const resp = await ask({ model, prompt: p.prompt + instructionFor(style), seed: 7 });
      const content = resp.message?.content ?? "";
      const verdict = checkAnswer(p, content);
      rows.push({
        id: p.id,
        pass: verdict.pass,
        extracted: verdict.extracted,
        seconds: (Date.now() - t0) / 1000,
        evalTokens: resp.eval_count ?? null,
        tokPerSec:
          resp.eval_count && resp.eval_duration
            ? Number((resp.eval_count / (resp.eval_duration / 1e9)).toFixed(1))
            : null,
        content,
      });
      console.log(`  [${style}] ${verdict.pass ? "PASS" : "FAIL"} ${p.id} (${rows.at(-1).seconds.toFixed(1)}s)`);
    } catch (e) {
      rows.push({ id: p.id, pass: false, error: String(e), seconds: (Date.now() - t0) / 1000 });
      console.log(`  [${style}] ERR  ${p.id}: ${String(e).slice(0, 80)}`);
    }
  }
  return rows;
}

async function refineFailures(model, directRows) {
  const failures = BATTERY_CLASSIC.filter((p) => directRows.find((r) => r.id === p.id && !r.pass && !r.error));
  const refined = [];
  for (const p of failures) {
    const iterations = [];
    const baseRow = directRows.find((r) => r.id === p.id);
    iterations.push({ extracted: baseRow.extracted ?? "", content: baseRow.content ?? "", correct: false });
    try {
      for (let i = 1; i <= ROUNDS; i++) {
        const resp = await ask({ model, prompt: revisionPrompt(p.prompt, iterations[i - 1].content), seed: 7 + i });
        const content = resp.message?.content ?? "";
        const verdict = checkAnswer(p, content);
        iterations.push({ extracted: verdict.extracted, content, correct: verdict.pass });
        const a = normalizeAnswer(verdict.extracted);
        if (a !== "" && a === normalizeAnswer(iterations[i - 1].extracted)) break; // honest convergence
      }
    } catch (e) {
      console.log(`  [refine] ERR ${p.id}: ${String(e).slice(0, 80)}`);
    }
    const final = iterations.at(-1);
    refined.push({
      id: p.id,
      fixed: Boolean(final.correct),
      trail: iterations.map((it) => it.extracted),
    });
    console.log(`  [refine] ${final.correct ? "FIXED" : "still wrong"} ${p.id}: ${iterations.map((it) => JSON.stringify(it.extracted.slice(0, 20))).join(" -> ")}`);
  }
  return refined;
}

const summary = [];
for (const model of MODELS) {
  console.log(`\n=== ${model} ===`);
  console.log(" direct probe:");
  const direct = await probeOnce(model, "direct");
  console.log(" free probe:");
  const free = await probeOnce(model, "free");
  console.log(" refinement on direct failures (free-form revisions):");
  const refined = await refineFailures(model, direct);

  const directPass = direct.filter((r) => r.pass).length;
  const freePass = free.filter((r) => r.pass).length;
  const fixed = refined.filter((r) => r.fixed).length;
  summary.push({
    model,
    n: BATTERY_CLASSIC.length,
    freeAccuracy: freePass,
    directAccuracy: directPass,
    pipelineAccuracy: directPass + fixed,
    fixedByLoop: refined.filter((r) => r.fixed).map((r) => r.id),
    stillWrong: refined.filter((r) => !r.fixed).map((r) => r.id),
    speedDirect: speedStats(direct),
    speedFree: speedStats(free),
    direct,
    free,
    refined,
  });
  console.log(
    `\n ${model}: free ${freePass}/22 | direct ${directPass}/22 | direct+loop ${directPass + fixed}/22 | ` +
      `direct speed ${speedStats(direct).avgTokPerSec} tok/s, free speed ${speedStats(free).avgTokPerSec} tok/s`
  );
}

console.log("\n===== SUMMARY =====");
for (const s of summary) {
  console.log(
    `${s.model.padEnd(16)} free=${s.freeAccuracy}/22  direct=${s.directAccuracy}/22  pipeline=${s.pipelineAccuracy}/22  ` +
      `tok/s(direct)=${s.speedDirect.avgTokPerSec}  sec/prob(free)=${s.speedFree.avgSeconds}`
  );
}

const fs = await import("node:fs");
fs.writeFileSync(OUT, JSON.stringify({ rounds: ROUNDS, when: new Date().toISOString(), summary }, null, 2));
console.log(`\nWrote ${OUT}`);
