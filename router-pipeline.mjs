// Deployable behavioral router (no oracle, no logprobs — works on any chat API):
//
//   Tier 1 (cheap): two independent direct + tool-enabled attempts (varied angle).
//     - if they AGREE  -> accept (stable answer, trusted).
//     - if they DISAGREE -> the answer is unstable, escalate.
//   Tier 2 (escalation): one fresh free-form CoT pass, no previous answer shown.
//
// Routing uses ONLY answer (in)stability — never the key. The key is used afterward
// only to score accuracy and to grade the routing decisions (did we escalate the
// ones that were actually wrong at tier 1?).
//
// Usage: node router-pipeline.mjs [--model gemma4:e4b] [--out router-pipeline-e4b.json]

import { BATTERY_CLASSIC, OLLAMA, checkAnswer, instructionFor, normalizeAnswer } from "./battery.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const MODEL = args.model ?? "gemma4:e4b";
const OUT = args.out ?? "router-pipeline-e4b.json";
const MAX_TOOL_TURNS = 4;

const TOOLS = [
  { type: "function", function: { name: "calculate", description: "Evaluate an arithmetic expression exactly. Supports + - * / ( ) and decimal numbers.", parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } } },
  { type: "function", function: { name: "count_occurrences", description: "Count how many times a letter or substring appears in a text (case-insensitive).", parameters: { type: "object", properties: { text: { type: "string" }, substring: { type: "string" } }, required: ["text", "substring"] } } },
  { type: "function", function: { name: "count_words", description: "Count the number of whitespace-separated words in a text.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } } },
  { type: "function", function: { name: "reverse_string", description: "Reverse a string character by character.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } } },
];

function runTool(name, rawArgs) {
  const a = typeof rawArgs === "string" ? JSON.parse(rawArgs) : (rawArgs ?? {});
  try {
    if (name === "calculate") {
      const expr = String(a.expression ?? "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/\^/g, "**").replace(/,/g, "");
      if (!/^[\d\s+\-*/().%*]+$/.test(expr)) return "error: invalid characters";
      return String(Function(`"use strict"; return (${expr});`)());
    }
    if (name === "count_occurrences") {
      const text = String(a.text ?? "").toLowerCase(), sub = String(a.substring ?? "").toLowerCase();
      if (!sub) return "error: empty substring";
      let n = 0; for (let i = 0; (i = text.indexOf(sub, i)) !== -1; i += 1) n++;
      return String(n);
    }
    if (name === "count_words") return String(String(a.text ?? "").trim().split(/\s+/).filter(Boolean).length);
    if (name === "reverse_string") return [...String(a.text ?? "")].reverse().join("");
    return "error: unknown tool";
  } catch (e) { return "error: " + String(e).slice(0, 80); }
}

const TOOL_SYS =
  "You have tools available. Use one only when it is an exact fit for what the question asks (counting letters or words, arithmetic on given numbers, reversing a string). Otherwise just answer the question normally.";

async function toolChat(userContent, seed) {
  const messages = [
    { role: "system", content: TOOL_SYS },
    { role: "user", content: userContent },
  ];
  let outTokens = 0, turns = 0, resp;
  do {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, stream: false, think: false, keep_alive: "15m", options: { temperature: 0, seed, num_predict: 1024 } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    resp = await res.json();
    outTokens += resp.eval_count ?? 0;
    if (resp.message?.tool_calls?.length && turns < MAX_TOOL_TURNS) {
      messages.push(resp.message);
      for (const tc of resp.message.tool_calls) messages.push({ role: "tool", tool_name: tc.function?.name, content: runTool(tc.function?.name, tc.function?.arguments) });
      turns++;
    } else break;
  } while (true);
  return { content: resp.message?.content ?? "", outTokens };
}

async function freeChat(userContent, seed) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: userContent }], stream: false, think: false, keep_alive: "15m", options: { temperature: 0, seed, num_predict: 1536 } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { content: j.message?.content ?? "", outTokens: j.eval_count ?? 0 };
}

const ANGLE_B = "\n\n(Solve this carefully, watching for any trap or trick in the wording.)";
const ESCALATE = "\n\nSolve this step by step, watching for traps, then give your answer.";

const results = [];
let totalTokens = 0;
console.log(`Behavioral router pipeline: ${MODEL} | tier1 direct+tools ×2, escalate-on-disagreement to fresh CoT\n`);

for (const p of BATTERY_CLASSIC) {
  try {
    const a = await toolChat(p.prompt + instructionFor("direct"), 7);
    const b = await toolChat(p.prompt + ANGLE_B + instructionFor("direct"), 8);
    const va = checkAnswer(p, a.content), vb = checkAnswer(p, b.content);
    const stable = normalizeAnswer(va.extracted) !== "" && normalizeAnswer(va.extracted) === normalizeAnswer(vb.extracted);
    let escalated = false, finalExtracted = va.extracted, finalCorrect = va.pass, tokens = a.outTokens + b.outTokens;
    if (!stable) {
      escalated = true;
      const c = await freeChat(p.prompt + ESCALATE + instructionFor("free"), 9);
      const vc = checkAnswer(p, c.content);
      finalExtracted = vc.extracted; finalCorrect = vc.pass; tokens += c.outTokens;
    }
    totalTokens += tokens;
    // tier-1 correctness (what we'd have shipped without escalation) for routing analysis
    const tier1Correct = va.pass;
    results.push({ id: p.id, stable, escalated, tier1Answer: va.extracted, tier1Correct, finalAnswer: finalExtracted, finalCorrect, tokens });
    console.log(`${finalCorrect ? "PASS" : "FAIL"}  ${p.id.padEnd(24)} ${stable ? "stable " : "ESCALATE"} ${String(tokens).padStart(4)}t  tier1=${va.extracted.slice(0, 16).padEnd(16)} -> final=${finalExtracted.slice(0, 20)}`);
  } catch (e) {
    results.push({ id: p.id, error: String(e) });
    console.log(`ERR   ${p.id}: ${String(e).slice(0, 100)}`);
  }
}

const ok = results.filter((r) => !r.error);
const escalated = ok.filter((r) => r.escalated);
const accepted = ok.filter((r) => !r.escalated);
console.log(`\n=== ${MODEL} behavioral router ===`);
console.log(`final accuracy:      ${ok.filter((r) => r.finalCorrect).length}/${ok.length}  (${totalTokens} output tokens)`);
console.log(`tier-1 only (no escalation): ${ok.filter((r) => r.tier1Correct).length}/${ok.length}`);
console.log(`escalated: ${escalated.length}/${ok.length}`);
console.log(`  good escalations (tier-1 was wrong): ${escalated.filter((r) => !r.tier1Correct).length}/${escalated.length}`);
console.log(`  of those, escalation FIXED:          ${escalated.filter((r) => !r.tier1Correct && r.finalCorrect).length}`);
console.log(`  wasted escalations (tier-1 was right): ${escalated.filter((r) => r.tier1Correct).length}`);
console.log(`missed errors (accepted but wrong):    ${accepted.filter((r) => !r.finalCorrect).length}  (${accepted.filter((r) => !r.finalCorrect).map((r) => r.id).join(", ") || "none"})`);

const fs = await import("node:fs");
fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, totalTokens, when: new Date().toISOString(), results }, null, 2));
console.log(`\nWrote ${OUT}`);
