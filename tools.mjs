// Tool-use experiment: same battery, direct answers, but the model gets a small
// generic toolbox (calculator + string utilities). Measures whether tools delete
// the perception/arithmetic failure classes.
//
// Usage: node tools.mjs [--model gemma4:e4b] [--out tools-e4b.json]

import { BATTERY_CLASSIC, OLLAMA, checkAnswer, instructionFor } from "./battery.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const MODEL = args.model ?? "gemma4:e4b";
const OUT = args.out ?? "tools-e4b.json";
const MAX_TOOL_TURNS = 5;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "calculate",
      description: "Evaluate an arithmetic expression exactly. Supports + - * / ( ) and decimal numbers.",
      parameters: {
        type: "object",
        properties: { expression: { type: "string", description: "e.g. ((17+28)*6-14)/4" } },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_occurrences",
      description: "Count how many times a letter or substring appears in a text (case-insensitive).",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          substring: { type: "string" },
        },
        required: ["text", "substring"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_words",
      description: "Count the number of whitespace-separated words in a text.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reverse_string",
      description: "Reverse a string character by character.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
  },
];

function runTool(name, rawArgs) {
  const a = typeof rawArgs === "string" ? JSON.parse(rawArgs) : (rawArgs ?? {});
  try {
    if (name === "calculate") {
      const expr = String(a.expression ?? "")
        .replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/\^/g, "**")
        .replace(/,/g, "");
      if (!/^[\d\s+\-*/().%*]+$/.test(expr)) return "error: invalid characters in expression";
      const val = Function(`"use strict"; return (${expr});`)();
      return String(val);
    }
    if (name === "count_occurrences") {
      const text = String(a.text ?? "").toLowerCase();
      const sub = String(a.substring ?? "").toLowerCase();
      if (!sub) return "error: empty substring";
      let n = 0;
      for (let i = 0; (i = text.indexOf(sub, i)) !== -1; i += 1) n++;
      return String(n);
    }
    if (name === "count_words") {
      return String(String(a.text ?? "").trim().split(/\s+/).filter(Boolean).length);
    }
    if (name === "reverse_string") {
      return [...String(a.text ?? "")].reverse().join("");
    }
    return "error: unknown tool";
  } catch (e) {
    return "error: " + String(e).slice(0, 100);
  }
}

const SYS =
  "You have tools available (calculator, substring counter, word counter, string reverser). Whenever a question involves counting letters or words, arithmetic, or manipulating strings, USE A TOOL rather than doing it in your head — tools are exact. After getting tool results, give your final answer.";

async function chatTurn(messages) {
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
      options: { temperature: 0, seed: 7, num_predict: 1024 },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

const results = [];
console.log(`Tool-use: ${MODEL} | direct answers + generic toolbox | ${BATTERY_CLASSIC.length} problems\n`);

for (const p of BATTERY_CLASSIC) {
  const t0 = Date.now();
  const toolCalls = [];
  let outTokens = 0;
  try {
    const messages = [
      { role: "system", content: SYS },
      { role: "user", content: p.prompt + instructionFor("direct") },
    ];
    let resp = await chatTurn(messages);
    outTokens += resp.eval_count ?? 0;
    let turns = 0;
    while (resp.message?.tool_calls?.length && turns < MAX_TOOL_TURNS) {
      messages.push(resp.message);
      for (const tc of resp.message.tool_calls) {
        const result = runTool(tc.function?.name, tc.function?.arguments);
        toolCalls.push({ name: tc.function?.name, args: tc.function?.arguments, result });
        messages.push({ role: "tool", tool_name: tc.function?.name, content: result });
      }
      resp = await chatTurn(messages);
      outTokens += resp.eval_count ?? 0;
      turns++;
    }
    const content = resp.message?.content ?? "";
    const verdict = checkAnswer(p, content);
    const secs = (Date.now() - t0) / 1000;
    results.push({
      id: p.id,
      pass: verdict.pass,
      extracted: verdict.extracted,
      toolCalls,
      outTokens,
      seconds: Number(secs.toFixed(1)),
      content,
    });
    console.log(
      `${verdict.pass ? "PASS" : "FAIL"}  ${p.id.padEnd(24)} tools:${String(toolCalls.length)} ${String(outTokens).padStart(4)} tok  ${secs.toFixed(1)}s  -> "${verdict.extracted.slice(0, 40)}"` +
        (toolCalls.length ? `  [${toolCalls.map((t) => t.name + "→" + String(t.result).slice(0, 12)).join(", ")}]` : "")
    );
  } catch (e) {
    results.push({ id: p.id, pass: false, error: String(e) });
    console.log(`ERR   ${p.id}: ${String(e).slice(0, 120)}`);
  }
}

const ok = results.filter((r) => !r.error);
const pass = ok.filter((r) => r.pass).length;
const used = ok.filter((r) => r.toolCalls?.length > 0);
console.log(`\n=== ${MODEL} with tools: ${pass}/${ok.length} | used tools on ${used.length} problems | total output tokens: ${ok.reduce((s, r) => s + (r.outTokens ?? 0), 0)} ===`);
console.log(`fails: ${ok.filter((r) => !r.pass).map((r) => r.id).join(", ") || "none"}`);

const fs = await import("node:fs");
fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, when: new Date().toISOString(), results }, null, 2));
console.log(`Wrote ${OUT}`);
