// Probe: run a battery of reasoning problems against a local Ollama model
// and report which ones it fails. Usage:
//   node probe.mjs [--model gemma4:latest] [--think false] [--temp 0] [--out probe-results.json]

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const MODEL = args.model ?? "gemma4:latest";
const THINK = (args.think ?? "false") === "true";
const TEMP = Number(args.temp ?? 0);
const STYLE = args.style ?? "free"; // free | direct
const PREDICT = Number(args.predict ?? 768); // raise for thinking mode — truncation looks like failure
const PRIME = (args.prime ?? "false") === "true"; // vigilance prime: fictional "you were wrong" system prompt

const VIGILANCE_PRIME =
  "You previously attempted to solve a problem.\nYOUR PREVIOUS ATTEMPT WAS WRONG.\n1. Re-read the problem carefully, watch for traps. 2. Solve it from scratch.\n3. Compare with the previous attempt and decide which is right. 4. Final answer.";
const OUT = args.out ?? "probe-results.json";
const OLLAMA = "http://localhost:11434";

const FORMAT_INSTR =
  STYLE === "direct"
    ? "\n\nAnswer with ONLY one line in exactly this form:\nFINAL: <your answer>\nDo not explain. Do not show any working or reasoning. Output nothing except that single line."
    : '\n\nEnd your response with exactly one line:\nFINAL: <your answer>\nwhere <your answer> is just the answer itself (a number, a word, or a short phrase).';

// type: "numeric" (compare number), "word" (FINAL contains expected, case-insensitive),
// "keywords" (any group fully matched against whole response text)
const PROBLEMS = [
  {
    id: "count-e-mercilessness",
    category: "counting",
    prompt: "How many times does the letter 'e' appear in the word \"mercilessness\"?",
    type: "numeric",
    expected: 3,
  },
  {
    id: "count-r-strawberry",
    category: "counting",
    prompt: "How many times does the letter 'r' appear in the word \"strawberry\"?",
    type: "numeric",
    expected: 3,
  },
  {
    id: "apples-yesterday",
    category: "trick",
    prompt: "I have 3 apples today. Yesterday I ate 2 apples. How many apples do I have now?",
    type: "numeric",
    expected: 3,
  },
  {
    id: "alice-sisters",
    category: "family-logic",
    prompt: "Alice has 4 sisters and 1 brother. How many sisters does Alice's brother have?",
    type: "numeric",
    expected: 5,
  },
  {
    id: "sally-sisters",
    category: "family-logic",
    prompt: "Sally (a girl) has 3 brothers. Each brother has 2 sisters. How many sisters does Sally have?",
    type: "numeric",
    expected: 1,
  },
  {
    id: "dead-cat",
    category: "trick",
    prompt:
      "A dead cat is placed into a box along with a nuclear isotope, a vial of poison and a radiation detector. If the detector senses radiation, it releases the poison. The box is opened one day later. What is the probability (as a number) that the cat is alive?",
    type: "numeric",
    expected: 0,
  },
  {
    id: "river-one-item",
    category: "trick",
    prompt:
      "A farmer is standing on one side of a river with only a goat. He has a boat that can carry himself and one animal. What is the minimum number of river crossings needed so that the farmer and the goat both end up on the other side?",
    type: "numeric",
    expected: 1,
  },
  {
    id: "days-before-friday",
    category: "date-math",
    prompt: "If today is Friday, what day of the week was it exactly 100 days ago?",
    type: "word",
    expected: "wednesday",
  },
  {
    id: "decimal-compare",
    category: "numeric",
    prompt: "Which number is larger: 9.11 or 9.9?",
    type: "word",
    expected: "9.9",
    forbidden: "9.11",
  },
  {
    id: "inclusive-days",
    category: "date-math",
    prompt: "How many days are there from March 3 to March 28, counting both March 3 and March 28?",
    type: "numeric",
    expected: 26,
  },
  {
    id: "multiply-2digit",
    category: "arithmetic",
    prompt: "What is 47 × 83?",
    type: "numeric",
    expected: 3901,
  },
  {
    id: "arithmetic-chain",
    category: "arithmetic",
    prompt: "Compute ((17 + 28) × 6 − 14) ÷ 4",
    type: "numeric",
    expected: 64,
  },
  {
    id: "month-children",
    category: "trick",
    prompt:
      "John's mother has three children. The first child is named April. The second child is named May. What is the name of the third child?",
    type: "word",
    expected: "john",
  },
  {
    id: "coins-30-cents",
    category: "trick",
    prompt:
      "I have two coins that add up to 30 cents. One of them is not a nickel. What are the two coins? (US coins: penny=1, nickel=5, dime=10, quarter=25)",
    type: "keywords",
    expectedKeywords: [["quarter", "nickel"]],
  },
  {
    id: "rooster-egg",
    category: "trick",
    prompt:
      "A rooster sits on the peak of a barn roof facing north. The wind blows east at 10 mph. If the rooster lays an egg, which side of the roof does it roll down?",
    type: "keywords",
    expectedKeywords: [
      ["don't lay"], ["do not lay"], ["doesn't lay"], ["does not lay"],
      ["can't lay"], ["cannot lay"], ["neither"],
    ],
  },
  {
    id: "spell-backwards",
    category: "string",
    prompt: "Spell the word \"lollipop\" backwards.",
    type: "word",
    expected: "popillol",
  },
  {
    id: "height-order",
    category: "logic",
    prompt:
      "Anna is shorter than Ben. Carl is taller than Ben. Dana is shorter than Anna. Emma is taller than Carl. Who is the third tallest?",
    type: "word",
    expected: "ben",
  },
  {
    id: "widow-marry",
    category: "trick",
    prompt: "Is it legal for a man to marry his widow's sister? Explain briefly.",
    type: "keywords",
    expectedKeywords: [["dead"], ["deceased"], ["died"]],
  },
  {
    id: "cupcakes-distractor",
    category: "word-problem",
    prompt:
      "A baker bakes 24 cupcakes. He sells 6 in the morning at $2 each and 8 in the afternoon at $3 each. He gives 4 to his neighbor for free. How many cupcakes does he have left?",
    type: "numeric",
    expected: 6,
  },
  {
    id: "count-words",
    category: "counting",
    prompt:
      "How many words are in this sentence: \"The cat sat on the mat while the dog slept near the door\"?",
    type: "numeric",
    expected: 13,
  },
  {
    id: "monty-random-host",
    category: "probability",
    prompt:
      "On a game show there are 3 doors; one hides a car, two hide goats. You pick door 1. The host, who does NOT know where the car is, opens door 3 completely at random, and it happens to reveal a goat. Should you switch to door 2, stay with door 1, or does it not matter?",
    type: "keywords",
    expectedKeywords: [
      ["not matter"], ["doesn't matter"], ["no advantage"], ["50/50"],
      ["50-50"], ["same chance"], ["equal chance"], ["either"],
    ],
  },
  {
    id: "weekday-feb14",
    category: "date-math",
    prompt:
      "January 1, 2026 was a Thursday. What day of the week was February 14, 2026? Note: January has 31 days.",
    type: "word",
    expected: "saturday",
  },
];

function extractFinal(text) {
  const matches = [...text.matchAll(/FINAL:\s*(.+)/gi)];
  if (matches.length > 0) return matches[matches.length - 1][1].trim();
  // fallback: last non-empty line
  const lines = text.trim().split("\n").filter((l) => l.trim());
  return lines.length ? lines[lines.length - 1].trim() : "";
}

function checkAnswer(problem, fullText) {
  const finalLine = extractFinal(fullText);
  const lower = finalLine.toLowerCase();
  const fullLower = fullText.toLowerCase();
  if (problem.type === "numeric") {
    const m = lower.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    const num = m ? Number(m[0]) : NaN;
    return { pass: num === problem.expected, extracted: finalLine, parsed: num };
  }
  if (problem.type === "word") {
    const pass =
      lower.includes(problem.expected.toLowerCase()) &&
      (!problem.forbidden || !lower.includes(problem.forbidden.toLowerCase()));
    return { pass, extracted: finalLine };
  }
  if (problem.type === "keywords") {
    const pass = problem.expectedKeywords.some((group) =>
      group.every((kw) => fullLower.includes(kw.toLowerCase()))
    );
    return { pass, extracted: finalLine };
  }
  return { pass: false, extracted: finalLine };
}

async function ask(prompt, { retryWithoutThink = true } = {}) {
  const body = {
    model: MODEL,
    messages: [
      ...(PRIME ? [{ role: "system", content: VIGILANCE_PRIME }] : []),
      { role: "user", content: prompt + FORMAT_INSTR },
    ],
    stream: false,
    think: THINK,
    keep_alive: "15m",
    options: { temperature: TEMP, seed: 7, num_predict: PREDICT },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180_000);
  try {
    let res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok && retryWithoutThink) {
      delete body.think;
      res = await fetch(`${OLLAMA}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
console.log(`Probing ${MODEL} | think=${THINK} | temp=${TEMP} | style=${STYLE} | prime=${PRIME} | ${PROBLEMS.length} problems\n`);

for (const p of PROBLEMS) {
  const t0 = Date.now();
  try {
    const resp = await ask(p.prompt);
    const content = resp.message?.content ?? "";
    const verdict = checkAnswer(p, content);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    results.push({
      id: p.id,
      category: p.category,
      pass: verdict.pass,
      extracted: verdict.extracted,
      expected: p.expected ?? p.expectedKeywords,
      seconds: Number(secs),
      evalTokens: resp.eval_count ?? null,
      tokPerSec:
        resp.eval_count && resp.eval_duration
          ? Number((resp.eval_count / (resp.eval_duration / 1e9)).toFixed(1))
          : null,
      content,
      thinking: resp.message?.thinking ?? null,
    });
    console.log(
      `${verdict.pass ? "PASS" : "FAIL"}  ${p.id.padEnd(24)} ${secs}s  -> "${verdict.extracted.slice(0, 80)}"` +
        (verdict.pass ? "" : `  (expected: ${JSON.stringify(p.expected ?? p.expectedKeywords[0])})`)
    );
  } catch (e) {
    results.push({ id: p.id, category: p.category, pass: false, error: String(e) });
    console.log(`ERR   ${p.id.padEnd(24)} ${String(e).slice(0, 100)}`);
  }
}

const fails = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - fails.length}/${results.length} passed ===`);
console.log(`Failing problems: ${fails.map((f) => f.id).join(", ") || "none"}`);

const fs = await import("node:fs");
fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, think: THINK, temp: TEMP, style: STYLE, when: new Date().toISOString(), results }, null, 2));
console.log(`\nWrote ${OUT}`);
