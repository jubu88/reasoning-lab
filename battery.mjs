// Shared problem batteries + checking + Ollama helpers for the experiment scripts.

export const OLLAMA = "http://localhost:11434";

export const BATTERY_CLASSIC = [
  { id: "count-e-mercilessness", category: "counting", prompt: "How many times does the letter 'e' appear in the word \"mercilessness\"?", type: "numeric", expected: 3 },
  { id: "count-r-strawberry", category: "counting", prompt: "How many times does the letter 'r' appear in the word \"strawberry\"?", type: "numeric", expected: 3 },
  { id: "apples-yesterday", category: "trick", prompt: "I have 3 apples today. Yesterday I ate 2 apples. How many apples do I have now?", type: "numeric", expected: 3 },
  { id: "alice-sisters", category: "family-logic", prompt: "Alice has 4 sisters and 1 brother. How many sisters does Alice's brother have?", type: "numeric", expected: 5 },
  { id: "sally-sisters", category: "family-logic", prompt: "Sally (a girl) has 3 brothers. Each brother has 2 sisters. How many sisters does Sally have?", type: "numeric", expected: 1 },
  { id: "dead-cat", category: "trick", prompt: "A dead cat is placed into a box along with a nuclear isotope, a vial of poison and a radiation detector. If the detector senses radiation, it releases the poison. The box is opened one day later. What is the probability (as a number) that the cat is alive?", type: "numeric", expected: 0 },
  { id: "river-one-item", category: "trick", prompt: "A farmer is standing on one side of a river with only a goat. He has a boat that can carry himself and one animal. What is the minimum number of river crossings needed so that the farmer and the goat both end up on the other side?", type: "numeric", expected: 1 },
  { id: "days-before-friday", category: "date-math", prompt: "If today is Friday, what day of the week was it exactly 100 days ago?", type: "word", expected: "wednesday" },
  { id: "decimal-compare", category: "numeric", prompt: "Which number is larger: 9.11 or 9.9?", type: "word", expected: "9.9", forbidden: "9.11" },
  { id: "inclusive-days", category: "date-math", prompt: "How many days are there from March 3 to March 28, counting both March 3 and March 28?", type: "numeric", expected: 26 },
  { id: "multiply-2digit", category: "arithmetic", prompt: "What is 47 × 83?", type: "numeric", expected: 3901 },
  { id: "arithmetic-chain", category: "arithmetic", prompt: "Compute ((17 + 28) × 6 − 14) ÷ 4", type: "numeric", expected: 64 },
  { id: "month-children", category: "trick", prompt: "John's mother has three children. The first child is named April. The second child is named May. What is the name of the third child?", type: "word", expected: "john" },
  { id: "coins-30-cents", category: "trick", prompt: "I have two coins that add up to 30 cents. One of them is not a nickel. What are the two coins? (US coins: penny=1, nickel=5, dime=10, quarter=25)", type: "keywords", expectedKeywords: [["quarter", "nickel"]] },
  { id: "rooster-egg", category: "trick", prompt: "A rooster sits on the peak of a barn roof facing north. The wind blows east at 10 mph. If the rooster lays an egg, which side of the roof does it roll down?", type: "keywords", expectedKeywords: [["don't lay"], ["do not lay"], ["doesn't lay"], ["does not lay"], ["can't lay"], ["cannot lay"], ["neither"]] },
  { id: "spell-backwards", category: "string", prompt: 'Spell the word "lollipop" backwards.', type: "word", expected: "popillol" },
  { id: "height-order", category: "logic", prompt: "Anna is shorter than Ben. Carl is taller than Ben. Dana is shorter than Anna. Emma is taller than Carl. Who is the third tallest?", type: "word", expected: "ben" },
  { id: "widow-marry", category: "trick", prompt: "Is it possible for a living man to marry his widow's sister? Answer yes or no, then explain briefly.", type: "word", expected: "no", forbidden: "yes" },
  { id: "cupcakes-distractor", category: "word-problem", prompt: "A baker bakes 24 cupcakes. He sells 6 in the morning at $2 each and 8 in the afternoon at $3 each. He gives 4 to his neighbor for free. How many cupcakes does he have left?", type: "numeric", expected: 6 },
  { id: "count-words", category: "counting", prompt: 'How many words are in this sentence: "The cat sat on the mat while the dog slept near the door"?', type: "numeric", expected: 13 },
  { id: "monty-random-host", category: "probability", prompt: "On a game show there are 3 doors; one hides a car, two hide goats. You pick door 1. The host, who does NOT know where the car is, opens door 3 completely at random, and it happens to reveal a goat. Should you switch to door 2, stay with door 1, or does it not matter?", type: "keywords", expectedKeywords: [["not matter"], ["doesn't matter"], ["no advantage"], ["50/50"], ["50-50"], ["same chance"], ["equal chance"], ["either"]] },
  { id: "weekday-feb14", category: "date-math", prompt: "January 1, 2026 was a Thursday. What day of the week was February 14, 2026? Note: January has 31 days.", type: "word", expected: "saturday" },
];

export const BATTERY_HARD = [
  { id: "count-s-possessionlessness", category: "counting", prompt: "How many times does the letter 's' appear in the word \"possessionlessness\"?", type: "numeric", expected: 8 },
  { id: "count-t-sentence", category: "counting", prompt: "How many times does the letter 't' (upper or lower case) appear in this sentence: \"The turtle trotted to the tiny town toting two tomatoes\"?", type: "numeric", expected: 15 },
  { id: "liar-puzzle", category: "logic", prompt: 'Alice says: "Bob is a liar." Bob says: "Carol is a liar." Carol says: "Alice and Bob are both liars." Each person is either always truthful or always a liar. Who is truthful?', type: "word", expected: "bob" },
  { id: "conditional-prob", category: "probability", prompt: "Two fair six-sided dice are rolled. Given that at least one die shows a 5, what is the probability that the sum is 9? Give the answer as a fraction.", type: "word", expected: "2/11" },
  { id: "age-puzzle", category: "algebra", prompt: "Tom is 24. Tom is twice as old as Sarah was when Tom was as old as Sarah is now. How old is Sarah?", type: "numeric", expected: 18 },
  { id: "clock-angle", category: "geometry", prompt: "A clock shows 3:15. What is the angle in degrees between the hour hand and the minute hand?", type: "numeric", expected: 7.5 },
  { id: "div-3-or-5", category: "number-theory", prompt: "How many integers between 1 and 100 inclusive are divisible by 3 or by 5 (or both)?", type: "numeric", expected: 47 },
  { id: "last-digit-7pow7", category: "number-theory", prompt: "What is the last digit of 7 to the power of 7 (7^7)?", type: "numeric", expected: 3 },
  { id: "digit-sum", category: "arithmetic", prompt: "What is the sum of the digits of 999,999,999 × 2?", type: "numeric", expected: 81 },
  { id: "zebra-mini", category: "logic", prompt: "Three friends — Maya, Noor, and Priya — each have a different pet (cat, dog, fish) and a different drink (tea, coffee, juice). The dog owner drinks coffee. Maya doesn't drink tea. Noor has the fish. Priya doesn't have the dog. The fish owner doesn't drink juice. Who drinks juice?", type: "word", expected: "priya" },
  { id: "look-and-say", category: "pattern", prompt: "What is the next term in this sequence: 1, 11, 21, 1211, 111221, ?", type: "word", expected: "312211" },
  { id: "crt-remainders", category: "number-theory", prompt: "Find the smallest positive integer that leaves remainder 2 when divided by 3, remainder 3 when divided by 5, and remainder 2 when divided by 7.", type: "numeric", expected: 23 },
  { id: "harmonic-speed", category: "rates", prompt: "A car travels from town A to town B at 30 mph and returns along the same road at 60 mph. What is its average speed for the entire round trip, in mph?", type: "numeric", expected: 40 },
  { id: "bookstore-stock", category: "word-problem", prompt: "A bookstore had 120 books. On Monday they sold 1/3 of them. On Tuesday they sold 1/4 of what remained. On Wednesday they received a shipment that doubled their current stock. How many books do they have now?", type: "numeric", expected: 120 },
];

export const ALL_PROBLEMS = [...BATTERY_CLASSIC, ...BATTERY_HARD];

export function instructionFor(style) {
  return style === "direct"
    ? "\n\nAnswer with ONLY one line in exactly this form:\nFINAL: <your answer>\nDo not explain. Do not show any working or reasoning. Output nothing except that single line."
    : '\n\nEnd your response with exactly one line:\nFINAL: <your answer>\nwhere <your answer> is just the answer itself (a number, a word, or a short phrase).';
}

export function extractFinal(text) {
  const matches = [...text.matchAll(/FINAL:\s*(.+)/gi)];
  if (matches.length > 0) return matches[matches.length - 1][1].trim();
  const lines = text.trim().split("\n").filter((l) => l.trim());
  return lines.length ? lines[lines.length - 1].trim() : "";
}

export function checkAnswer(problem, fullText) {
  const finalLine = extractFinal(fullText);
  const lower = finalLine.toLowerCase();
  const fullLower = fullText.toLowerCase();
  if (problem.type === "numeric") {
    const m = lower.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    const num = m ? Number(m[0]) : NaN;
    return { pass: num === problem.expected, extracted: finalLine };
  }
  if (problem.type === "word") {
    const pass =
      lower.includes(String(problem.expected).toLowerCase()) &&
      (!problem.forbidden || !lower.includes(problem.forbidden.toLowerCase()));
    return { pass, extracted: finalLine };
  }
  // keywords are matched against the FINAL line by default to avoid false positives
  // from correct-sounding phrases buried inside wrong reasoning
  const hay = problem.keywordsScope === "full" ? fullLower : lower;
  const pass = (problem.expectedKeywords ?? []).some((group) =>
    group.every((kw) => hay.includes(kw.toLowerCase()))
  );
  return { pass, extracted: finalLine };
}

export function normalizeAnswer(s) {
  return s.toLowerCase().replace(/[^a-z0-9.\- ]/g, "").replace(/\s+/g, " ").trim();
}

export async function ask({ model, prompt, think = false, temperature = 0, seed = 7, numPredict = 2048, timeoutMs = 300_000 }) {
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    think,
    keep_alive: "20m",
    options: { temperature, seed, num_predict: numPredict },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
