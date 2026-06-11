// Probe round 2: harder reasoning problems for models that pass the classic trick battery.
// Usage: node probe2.mjs [--model gemma4:latest] [--think false] [--temp 0] [--style free|direct] [--out probe2-results.json]

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const MODEL = args.model ?? "gemma4:latest";
const THINK = (args.think ?? "false") === "true";
const TEMP = Number(args.temp ?? 0);
const STYLE = args.style ?? "free";
const OUT = args.out ?? "probe2-results.json";
const OLLAMA = "http://localhost:11434";

const FORMAT_INSTR =
  STYLE === "direct"
    ? "\n\nAnswer with ONLY one line in exactly this form:\nFINAL: <your answer>\nDo not explain. Do not show any working or reasoning. Output nothing except that single line."
    : '\n\nEnd your response with exactly one line:\nFINAL: <your answer>\nwhere <your answer> is just the answer itself (a number, a word, or a short phrase).';

const PROBLEMS = [
  {
    id: "count-s-possessionlessness",
    category: "counting",
    prompt: "How many times does the letter 's' appear in the word \"possessionlessness\"?",
    type: "numeric",
    expected: 8,
  },
  {
    id: "count-t-sentence",
    category: "counting",
    prompt:
      "How many times does the letter 't' (upper or lower case) appear in this sentence: \"The turtle trotted to the tiny town toting two tomatoes\"?",
    type: "numeric",
    expected: 15,
  },
  {
    id: "liar-puzzle",
    category: "logic",
    prompt:
      "Alice says: \"Bob is a liar.\" Bob says: \"Carol is a liar.\" Carol says: \"Alice and Bob are both liars.\" Each person is either always truthful or always a liar. Who is truthful?",
    type: "word",
    expected: "bob",
  },
  {
    id: "conditional-prob",
    category: "probability",
    prompt:
      "Two fair six-sided dice are rolled. Given that at least one die shows a 5, what is the probability that the sum is 9? Give the answer as a fraction.",
    type: "word",
    expected: "2/11",
  },
  {
    id: "age-puzzle",
    category: "algebra",
    prompt:
      "Tom is 24. Tom is twice as old as Sarah was when Tom was as old as Sarah is now. How old is Sarah?",
    type: "numeric",
    expected: 18,
  },
  {
    id: "clock-angle",
    category: "geometry",
    prompt:
      "A clock shows 3:15. What is the angle in degrees between the hour hand and the minute hand?",
    type: "numeric",
    expected: 7.5,
  },
  {
    id: "div-3-or-5",
    category: "number-theory",
    prompt: "How many integers between 1 and 100 inclusive are divisible by 3 or by 5 (or both)?",
    type: "numeric",
    expected: 47,
  },
  {
    id: "last-digit-7pow7",
    category: "number-theory",
    prompt: "What is the last digit of 7 to the power of 7 (7^7)?",
    type: "numeric",
    expected: 3,
  },
  {
    id: "digit-sum",
    category: "arithmetic",
    prompt: "What is the sum of the digits of 999,999,999 × 2?",
    type: "numeric",
    expected: 81,
  },
  {
    id: "zebra-mini",
    category: "logic",
    prompt:
      "Three friends — Maya, Noor, and Priya — each have a different pet (cat, dog, fish) and a different drink (tea, coffee, juice). The dog owner drinks coffee. Maya doesn't drink tea. Noor has the fish. Priya doesn't have the dog. The fish owner doesn't drink juice. Who drinks juice?",
    type: "word",
    expected: "priya",
  },
  {
    id: "look-and-say",
    category: "pattern",
    prompt: "What is the next term in this sequence: 1, 11, 21, 1211, 111221, ?",
    type: "word",
    expected: "312211",
  },
  {
    id: "crt-remainders",
    category: "number-theory",
    prompt:
      "Find the smallest positive integer that leaves remainder 2 when divided by 3, remainder 3 when divided by 5, and remainder 2 when divided by 7.",
    type: "numeric",
    expected: 23,
  },
  {
    id: "harmonic-speed",
    category: "rates",
    prompt:
      "A car travels from town A to town B at 30 mph and returns along the same road at 60 mph. What is its average speed for the entire round trip, in mph?",
    type: "numeric",
    expected: 40,
  },
  {
    id: "bookstore-stock",
    category: "word-problem",
    prompt:
      "A bookstore had 120 books. On Monday they sold 1/3 of them. On Tuesday they sold 1/4 of what remained. On Wednesday they received a shipment that doubled their current stock. How many books do they have now?",
    type: "numeric",
    expected: 120,
  },
];

function extractFinal(text) {
  const matches = [...text.matchAll(/FINAL:\s*(.+)/gi)];
  if (matches.length > 0) return matches[matches.length - 1][1].trim();
  const lines = text.trim().split("\n").filter((l) => l.trim());
  return lines.length ? lines[lines.length - 1].trim() : "";
}

function checkAnswer(problem, fullText) {
  const finalLine = extractFinal(fullText);
  const lower = finalLine.toLowerCase();
  if (problem.type === "numeric") {
    const m = lower.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    const num = m ? Number(m[0]) : NaN;
    return { pass: num === problem.expected, extracted: finalLine };
  }
  const pass = lower.includes(String(problem.expected).toLowerCase());
  return { pass, extracted: finalLine };
}

async function ask(prompt) {
  const body = {
    model: MODEL,
    messages: [{ role: "user", content: prompt + FORMAT_INSTR }],
    stream: false,
    think: THINK,
    keep_alive: "15m",
    options: { temperature: TEMP, seed: 7, num_predict: 2048 },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 240_000);
  try {
    let res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
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
console.log(`Probe 2: ${MODEL} | think=${THINK} | temp=${TEMP} | style=${STYLE} | ${PROBLEMS.length} problems\n`);

for (const p of PROBLEMS) {
  const t0 = Date.now();
  try {
    const resp = await ask(p.prompt);
    const content = resp.message?.content ?? "";
    const verdict = checkAnswer(p, content);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    results.push({
      id: p.id, category: p.category, pass: verdict.pass,
      extracted: verdict.extracted, expected: p.expected, seconds: Number(secs),
      evalTokens: resp.eval_count ?? null,
      tokPerSec:
        resp.eval_count && resp.eval_duration
          ? Number((resp.eval_count / (resp.eval_duration / 1e9)).toFixed(1))
          : null,
      content,
    });
    console.log(
      `${verdict.pass ? "PASS" : "FAIL"}  ${p.id.padEnd(28)} ${secs}s  -> "${verdict.extracted.slice(0, 70)}"` +
        (verdict.pass ? "" : `  (expected: ${p.expected})`)
    );
  } catch (e) {
    results.push({ id: p.id, category: p.category, pass: false, error: String(e) });
    console.log(`ERR   ${p.id.padEnd(28)} ${String(e).slice(0, 100)}`);
  }
}

const fails = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - fails.length}/${results.length} passed ===`);
console.log(`Failing: ${fails.map((f) => f.id).join(", ") || "none"}`);

const fs = await import("node:fs");
fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, think: THINK, temp: TEMP, style: STYLE, when: new Date().toISOString(), results }, null, 2));
console.log(`\nWrote ${OUT}`);
