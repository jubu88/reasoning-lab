// The confidence router experiment: do token logprobs separate correct answers
// from confidently-wrong ones? If yes, escalation can be routed WITHOUT an
// answer key — the missing piece of the deployable pipeline.
//
// Requires llama-server running with a gemma4 GGUF, e.g.:
//   llama-server -m gemma-4-E4B-it-Q4_K_M.gguf -ngl 99 -c 2048 --port 8089
//
// Usage: node router.mjs [--port 8089] [--out router-results.json]

import { BATTERY_CLASSIC, checkAnswer, instructionFor } from "./battery.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const PORT = args.port ?? "8089";
const OUT = args.out ?? "router-results.json";
const BASE = `http://127.0.0.1:${PORT}`;

async function askWithLogprobs(prompt) {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemma4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 128,
      logprobs: true,
      top_logprobs: 1,
      // the GGUF chat template enables gemma4's thinking channel by default,
      // which swallows the token budget and leaves content empty
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const choice = data.choices[0];
  return {
    content: choice.message?.content ?? "",
    tokens: (choice.logprobs?.content ?? []).map((t) => ({ token: t.token, logprob: t.logprob })),
  };
}

// confidence over the answer tokens: everything generated after "FINAL:" appears
function answerConfidence(tokens) {
  let cum = "";
  let startIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    cum += tokens[i].token;
    if (startIdx === -1 && /FINAL\s*:/i.test(cum)) startIdx = i + 1;
  }
  const slice = startIdx >= 0 && startIdx < tokens.length ? tokens.slice(startIdx) : tokens;
  const meaningful = slice.filter((t) => t.token.trim().length > 0);
  const probs = (meaningful.length ? meaningful : slice).map((t) => Math.exp(t.logprob));
  if (probs.length === 0) return { meanP: 0, minP: 0, n: 0 };
  return {
    meanP: probs.reduce((s, p) => s + p, 0) / probs.length,
    minP: Math.min(...probs),
    n: probs.length,
  };
}

const results = [];
console.log(`Router experiment via llama-server :${PORT} | ${BATTERY_CLASSIC.length} problems, direct answers + logprobs\n`);

for (const p of BATTERY_CLASSIC) {
  try {
    const r = await askWithLogprobs(p.prompt + instructionFor("direct"));
    const verdict = checkAnswer(p, r.content);
    const conf = answerConfidence(r.tokens);
    results.push({
      id: p.id,
      correct: verdict.pass,
      extracted: verdict.extracted,
      meanP: Number(conf.meanP.toFixed(4)),
      minP: Number(conf.minP.toFixed(4)),
      nAnswerTokens: conf.n,
      tokens: r.tokens,
    });
    console.log(
      `${verdict.pass ? "PASS" : "FAIL"}  ${p.id.padEnd(24)} meanP=${conf.meanP.toFixed(3)}  minP=${conf.minP.toFixed(3)}  -> "${verdict.extracted.slice(0, 36)}"`
    );
  } catch (e) {
    results.push({ id: p.id, error: String(e) });
    console.log(`ERR   ${p.id}: ${String(e).slice(0, 100)}`);
  }
}

const ok = results.filter((r) => !r.error);
const correct = ok.filter((r) => r.correct);
const wrong = ok.filter((r) => !r.correct);
const avg = (rows, k) => (rows.length ? rows.reduce((s, r) => s + r[k], 0) / rows.length : NaN);

console.log(`\n=== confidence vs correctness (${correct.length} correct, ${wrong.length} wrong) ===`);
console.log(`correct answers: meanP avg ${avg(correct, "meanP").toFixed(3)} | minP avg ${avg(correct, "minP").toFixed(3)}`);
console.log(`wrong answers:   meanP avg ${avg(wrong, "meanP").toFixed(3)} | minP avg ${avg(wrong, "minP").toFixed(3)}`);

// threshold sweep on minP: escalate everything below the threshold
console.log(`\nthreshold sweep (escalate if minP < t):`);
const cands = [...new Set(ok.map((r) => r.minP))].sort((a, b) => a - b);
let best = null;
for (const t of cands.map((c) => c + 1e-9)) {
  const escalated = ok.filter((r) => r.minP < t);
  const caught = escalated.filter((r) => !r.correct).length;
  const falseAlarms = escalated.filter((r) => r.correct).length;
  const missed = wrong.length - caught;
  const score = caught - falseAlarms * 0.3; // catching errors worth more than escalation cost
  if (!best || score > best.score) best = { t, caught, falseAlarms, missed, escalated: escalated.length, score };
}
if (best) {
  console.log(
    `best minP threshold ≈ ${best.t.toFixed(3)}: escalates ${best.escalated}/22, catches ${best.caught}/${wrong.length} wrong, ${best.falseAlarms} false alarms, misses ${best.missed}`
  );
}

const fs = await import("node:fs");
fs.writeFileSync(OUT, JSON.stringify({ when: new Date().toISOString(), results, summary: { correctMeanP: avg(correct, "meanP"), wrongMeanP: avg(wrong, "meanP"), correctMinP: avg(correct, "minP"), wrongMinP: avg(wrong, "minP"), best } }, null, 2));
console.log(`\nWrote ${OUT}`);
