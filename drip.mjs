// Drip-feed strategy: split the problem into sentences and feed them one at a
// time as separate conversation turns. The model acknowledges each premise
// before the final question arrives. Final answer style is DIRECT, so any gain
// comes from incremental premise processing, not from free-form reasoning.
//
// Usage: node drip.mjs [--model gemma4:e4b] [--style direct] [--out drip-results.json]

import { BATTERY_CLASSIC, ask, checkAnswer, instructionFor } from "./battery.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const MODEL = args.model ?? "gemma4:e4b";
const STYLE = args.style ?? "direct";
const OUT = args.out ?? "drip-results.json";

const SYS =
  "I will give you a problem one sentence at a time. After each sentence, reply with ONE short sentence noting what you now know. Do not try to solve anything until I ask the final question.";

function splitSentences(text) {
  const parts = text.match(/[^.!?]+[.!?]+["')]?(?:\s+|$)|[^.!?]+$/g) ?? [text];
  return parts.map((s) => s.trim()).filter(Boolean);
}

const results = [];
console.log(`Drip-feed: ${MODEL} | final style=${STYLE} | ${BATTERY_CLASSIC.length} problems\n`);

for (const p of BATTERY_CLASSIC) {
  const sents = splitSentences(p.prompt);
  const t0 = Date.now();
  let outTokens = 0;
  const turns = [];
  try {
    const messages = [{ role: "system", content: SYS }];
    // feed all sentences except the last (the question) one at a time
    for (let i = 0; i < sents.length - 1; i++) {
      messages.push({ role: "user", content: sents[i] });
      const resp = await ask({ model: MODEL, messages, seed: 7, numPredict: 150 });
      const ack = resp.message?.content ?? "";
      outTokens += resp.eval_count ?? 0;
      messages.push({ role: "assistant", content: ack });
      turns.push({ sentence: sents[i], ack });
    }
    // final question with the answer-style instruction
    messages.push({ role: "user", content: sents[sents.length - 1] + instructionFor(STYLE) });
    const fin = await ask({ model: MODEL, messages, seed: 7, numPredict: 1024 });
    outTokens += fin.eval_count ?? 0;
    const content = fin.message?.content ?? "";
    const verdict = checkAnswer(p, content);
    const secs = (Date.now() - t0) / 1000;
    results.push({
      id: p.id,
      sentences: sents.length,
      dripped: sents.length > 1,
      pass: verdict.pass,
      extracted: verdict.extracted,
      outTokens,
      seconds: Number(secs.toFixed(1)),
      turns,
      finalContent: content,
    });
    console.log(
      `${verdict.pass ? "PASS" : "FAIL"}  ${p.id.padEnd(24)} ${String(sents.length).padStart(2)} sent  ${String(outTokens).padStart(4)} tok  ${secs.toFixed(1)}s  -> "${verdict.extracted.slice(0, 50)}"`
    );
  } catch (e) {
    results.push({ id: p.id, pass: false, error: String(e) });
    console.log(`ERR   ${p.id}: ${String(e).slice(0, 100)}`);
  }
}

const ok = results.filter((r) => !r.error);
const pass = ok.filter((r) => r.pass).length;
const multi = ok.filter((r) => r.dripped);
const totalTok = ok.reduce((s, r) => s + (r.outTokens ?? 0), 0);
console.log(`\n=== ${MODEL} drip-feed: ${pass}/${ok.length} | multi-sentence problems: ${multi.filter((r) => r.pass).length}/${multi.length} | total output tokens: ${totalTok} ===`);
console.log(`fails: ${ok.filter((r) => !r.pass).map((r) => r.id).join(", ") || "none"}`);

const fs = await import("node:fs");
fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, style: STYLE, when: new Date().toISOString(), results }, null, 2));
console.log(`Wrote ${OUT}`);
