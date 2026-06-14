// Cross-model referee cascade: gemma4 answers cheaply and flags unstable answers
// (behavioral routing from router-pipeline output); a DIFFERENT model family
// (deepseek-r1) re-solves the flagged ones. Different priors see through different
// illusions — this is the path to closing gemma's weight-level blind spots (widow).
//
// Two-pass by design: reads the already-recorded gemma routing run, then loads
// deepseek-r1 ONCE to solve only the forwarded problems (no per-problem model swap).
//
// Usage: node referee.mjs [--in router-pipeline-e4b.json] [--referee deepseek-r1:latest]
//                         [--out referee-results.json]

import { BATTERY_CLASSIC, OLLAMA, checkAnswer, instructionFor } from "./battery.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const IN = args.in ?? "router-pipeline-e4b.json";
const REFEREE = args.referee ?? "deepseek-r1:latest";
const OUT = args.out ?? "referee-results.json";

const fs = await import("node:fs");
const gemma = JSON.parse(fs.readFileSync(IN, "utf8")).results.filter((r) => !r.error);

// which problems to forward to the referee. Default: gemma's behaviorally-flagged
// (escalated) set. Override with --ids a,b,c to measure the referee's rescue ceiling
// on a chosen set (e.g. gemma's persistent hard failures) — label such runs as
// oracle-routed in the writeup (a real router must identify these; the logprobs
// router does, the 2-attempt behavioral router does not).
const forwarded = args.ids
  ? args.ids.split(",").map((s) => s.trim())
  : gemma.filter((r) => r.escalated).map((r) => r.id);
console.log(`Referee cascade: gemma routing from ${IN} | referee=${REFEREE}`);
console.log(`gemma forwarded ${forwarded.length} unstable problems: ${forwarded.join(", ")}\n`);

// MUST stream: deepseek thinking can run minutes; stream:false makes undici's
// ~300s headers timeout fire because headers only arrive when generation completes.
async function askReferee(prompt) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: REFEREE,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      keep_alive: "15m",
      // num_ctx must exceed num_predict + prompt, or long thinking overflows the
      // KV cache and the model rambles incoherently (context loss)
      options: { temperature: 0, seed: 7, num_predict: 8000, num_ctx: 12288 },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", content = "", tokens = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const c = JSON.parse(line);
        content += c.message?.content ?? "";
        if (c.eval_count) tokens = c.eval_count;
      } catch {}
    }
  }
  return { content, tokens };
}

const refereeResults = {};
let refTokens = 0;
for (const id of forwarded) {
  const p = BATTERY_CLASSIC.find((x) => x.id === id);
  try {
    const r = await askReferee(p.prompt + instructionFor("free"));
    const v = checkAnswer(p, r.content);
    refereeResults[id] = { extracted: v.extracted, correct: v.pass, tokens: r.tokens };
    refTokens += r.tokens;
    console.log(`${v.pass ? "PASS" : "FAIL"}  ${id.padEnd(24)} ${r.tokens}t  -> "${v.extracted.slice(0, 40)}"`);
  } catch (e) {
    refereeResults[id] = { error: String(e) };
    console.log(`ERR   ${id}: ${String(e).slice(0, 100)}`);
  }
}

// combined cascade: referee's answer for any FORWARDED problem (resolved without
// error), gemma's otherwise
let cascadeCorrect = 0;
const rows = gemma.map((g) => {
  const usedReferee = forwarded.includes(g.id) && refereeResults[g.id] && !refereeResults[g.id].error;
  const correct = usedReferee ? refereeResults[g.id].correct : g.finalCorrect;
  if (correct) cascadeCorrect++;
  return { id: g.id, source: usedReferee ? "referee" : "gemma", correct };
});

const gemmaAlone = gemma.filter((r) => r.finalCorrect).length;
const refFixed = forwarded.filter((id) => refereeResults[id]?.correct && !gemma.find((g) => g.id === id).finalCorrect).length;
const refBroke = forwarded.filter((id) => refereeResults[id] && !refereeResults[id].error && !refereeResults[id].correct && gemma.find((g) => g.id === id).finalCorrect).length;

console.log(`\n=== cascade: gemma4 + ${REFEREE} referee ===`);
console.log(`gemma alone (router pipeline): ${gemmaAlone}/${gemma.length}`);
console.log(`referee solved of forwarded:   ${forwarded.filter((id) => refereeResults[id]?.correct).length}/${forwarded.length}  (${refTokens} referee tokens)`);
console.log(`cascade final:                 ${cascadeCorrect}/${gemma.length}  (referee net: +${refFixed} fixed, -${refBroke} broken)`);
console.log(`still wrong after cascade:     ${rows.filter((r) => !r.correct).map((r) => r.id).join(", ") || "none"}`);

fs.writeFileSync(OUT, JSON.stringify({ referee: REFEREE, in: IN, forwarded, refereeResults, rows, cascadeCorrect, total: gemma.length, when: new Date().toISOString() }, null, 2));
console.log(`\nWrote ${OUT}`);
