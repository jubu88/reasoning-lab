// The full stack, measured end to end:
//   Stage 1 — direct answer + generic toolbox
//   Stage 2 — restart loop (fresh context, previous attempt shown, direct + tools, converge stop)
//   Stage 3 — escalation: fresh free-form re-ask (NO previous answer) + tools, resample + confirm
// Stage 3 routing uses the answer key (oracle) — flagged in output; a deployable router
// needs a confidence signal (see RESULTS.md).
//
// Usage: node pipeline.mjs [--model gemma4:e4b] [--out pipeline-e4b.json]

import { BATTERY_CLASSIC, OLLAMA, checkAnswer, instructionFor, normalizeAnswer } from "./battery.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const MODEL = args.model ?? "gemma4:e4b";
const OUT = args.out ?? "pipeline-e4b.json";
const MAX_TOOL_TURNS = 5;
const LOOP_ROUNDS = 2;
const ESC_ROUNDS = 2;

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
      const text = String(a.text ?? "").toLowerCase();
      const sub = String(a.substring ?? "").toLowerCase();
      if (!sub) return "error: empty substring";
      let n = 0;
      for (let i = 0; (i = text.indexOf(sub, i)) !== -1; i += 1) n++;
      return String(n);
    }
    if (name === "count_words") return String(String(a.text ?? "").trim().split(/\s+/).filter(Boolean).length);
    if (name === "reverse_string") return [...String(a.text ?? "")].reverse().join("");
    return "error: unknown tool";
  } catch (e) {
    return "error: " + String(e).slice(0, 100);
  }
}

const SYS =
  "You have tools available (calculator, substring counter, word counter, string reverser). Whenever a question involves counting letters or words, arithmetic, or manipulating strings, USE A TOOL rather than doing it in your head — tools are exact. After getting tool results, give your final answer.";

async function toolChat(userContent) {
  const messages = [
    { role: "system", content: SYS },
    { role: "user", content: userContent },
  ];
  let outTokens = 0;
  const toolCalls = [];
  let resp;
  let turns = 0;
  do {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: TOOLS,
        stream: false,
        think: false,
        keep_alive: "15m",
        options: { temperature: 0, seed: 7 + turns, num_predict: 1536 },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    resp = await res.json();
    outTokens += resp.eval_count ?? 0;
    if (resp.message?.tool_calls?.length && turns < MAX_TOOL_TURNS) {
      messages.push(resp.message);
      for (const tc of resp.message.tool_calls) {
        const result = runTool(tc.function?.name, tc.function?.arguments);
        toolCalls.push({ name: tc.function?.name, result });
        messages.push({ role: "tool", tool_name: tc.function?.name, content: result });
      }
      turns++;
    } else break;
  } while (true);
  return { content: resp.message?.content ?? "", outTokens, toolCalls };
}

function revisionPrompt(problemPrompt, prevContent) {
  return (
    "You previously attempted to solve a problem. Your job now is to carefully review that attempt and produce a final answer.\n\n" +
    `PROBLEM:\n${problemPrompt}\n\n` +
    `YOUR PREVIOUS ATTEMPT:\n${prevContent}\n\n` +
    "INSTRUCTIONS:\n" +
    "1. Re-read the problem very carefully. Watch for traps, irrelevant details, and wording tricks.\n" +
    "2. Solve the problem yourself from scratch (use tools where they apply).\n" +
    "3. Compare your result with the previous attempt. If they differ, work out which one is actually right.\n" +
    "4. State your final answer." +
    instructionFor("direct")
  );
}

const results = [];
let s1tok = 0, s2tok = 0, s3tok = 0;
console.log(`Pipeline: ${MODEL} | tools everywhere | loop ${LOOP_ROUNDS} rounds | escalation ${ESC_ROUNDS} rounds\n`);

for (const p of BATTERY_CLASSIC) {
  const rec = { id: p.id, stages: {} };
  try {
    // Stage 1: direct + tools
    const s1 = await toolChat(p.prompt + instructionFor("direct"));
    s1tok += s1.outTokens;
    let v = checkAnswer(p, s1.content);
    rec.stages.s1 = { answer: v.extracted, correct: v.pass, tokens: s1.outTokens, tools: s1.toolCalls.length };
    let current = { content: s1.content, extracted: v.extracted, pass: v.pass };

    // Stage 2: restart loop, converge stop
    let loopTok = 0;
    for (let i = 0; i < LOOP_ROUNDS; i++) {
      const r = await toolChat(revisionPrompt(p.prompt, current.content));
      loopTok += r.outTokens;
      const rv = checkAnswer(p, r.content);
      const converged = normalizeAnswer(rv.extracted) === normalizeAnswer(current.extracted) && normalizeAnswer(rv.extracted) !== "";
      current = { content: r.content, extracted: rv.extracted, pass: rv.pass };
      if (converged) break;
    }
    s2tok += loopTok;
    rec.stages.s2 = { answer: current.extracted, correct: current.pass, tokens: loopTok };

    // Stage 3: escalation (oracle-routed) — fresh free-form re-ask, no previous answer
    if (!current.pass) {
      let escTok = 0;
      let escAnswer = null;
      for (let i = 0; i < ESC_ROUNDS; i++) {
        const r = await toolChat(p.prompt + instructionFor("free"));
        escTok += r.outTokens;
        const rv = checkAnswer(p, r.content);
        if (escAnswer && normalizeAnswer(rv.extracted) === normalizeAnswer(escAnswer.extracted)) {
          escAnswer = { extracted: rv.extracted, pass: rv.pass };
          break;
        }
        escAnswer = { extracted: rv.extracted, pass: rv.pass };
      }
      s3tok += escTok;
      rec.stages.s3 = { answer: escAnswer.extracted, correct: escAnswer.pass, tokens: escTok };
      rec.final = { answer: escAnswer.extracted, correct: escAnswer.pass };
    } else {
      rec.final = { answer: current.extracted, correct: current.pass };
    }
    results.push(rec);
    const path = ["s1", "s2", "s3"].filter((k) => rec.stages[k]).map((k) => `${k}:${rec.stages[k].correct ? "✓" : "✗"}${JSON.stringify(rec.stages[k].answer.slice(0, 18))}`).join(" → ");
    console.log(`${rec.final.correct ? "PASS" : "FAIL"}  ${p.id.padEnd(24)} ${path}`);
  } catch (e) {
    results.push({ id: p.id, error: String(e), final: { correct: false } });
    console.log(`ERR   ${p.id}: ${String(e).slice(0, 120)}`);
  }
}

const ok = results.filter((r) => !r.error);
const final = ok.filter((r) => r.final.correct).length;
const s1pass = ok.filter((r) => r.stages?.s1?.correct).length;
const s2pass = ok.filter((r) => r.stages?.s2?.correct).length;
console.log(`\n=== ${MODEL} full pipeline ===`);
console.log(`stage 1 (direct+tools):        ${s1pass}/${ok.length}   ${s1tok} tokens`);
console.log(`stage 2 (+restart loop):       ${s2pass}/${ok.length}   +${s2tok} tokens`);
console.log(`stage 3 (+fresh-CoT escalation): ${final}/${ok.length}   +${s3tok} tokens (oracle-routed)`);
console.log(`TOTAL: ${final}/${ok.length} at ${s1tok + s2tok + s3tok} output tokens`);

const fs = await import("node:fs");
fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, when: new Date().toISOString(), s1tok, s2tok, s3tok, results }, null, 2));
console.log(`Wrote ${OUT}`);
