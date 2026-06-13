// Generates PROBLEMS.md from battery.mjs — the same definitions the experiments
// score against, so the doc can never drift from what actually runs.
// Usage: node gen-problems.mjs

import { BATTERY_CLASSIC, BATTERY_HARD } from "./battery.mjs";

function expectedText(p) {
  if (p.type === "numeric") return String(p.expected);
  if (p.type === "word") return p.forbidden ? `${p.expected} (not ${p.forbidden})` : String(p.expected);
  // keywords: groups are alternatives; within a group all must appear
  return (p.expectedKeywords ?? [])
    .map((group) => group.join(" + "))
    .join(" / ");
}

function esc(s) {
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function table(problems) {
  const rows = problems
    .map(
      (p) =>
        `| \`${p.id}\` | ${p.category} | ${esc(p.prompt)} | ${esc(expectedText(p))} |`
    )
    .join("\n");
  return `| id | category | question | expected |\n|---|---|---|---|\n${rows}`;
}

const md = `# The problem batteries

Auto-generated from \`battery.mjs\` by \`gen-problems.mjs\` — these are the exact problems and
answer keys the experiments score against. Do not edit by hand; run \`node gen-problems.mjs\`
to regenerate. How answers are checked (numeric / word / keyword matching, the \`FINAL:\`
convention, determinism, caveats) is documented in [EXPERIMENTS.md](EXPERIMENTS.md#methodology--how-the-harness-actually-works).

## Classic battery (${BATTERY_CLASSIC.length} problems)

Trick / reasoning questions, each chosen to probe a specific failure class of small local LLMs.

${table(BATTERY_CLASSIC)}

## Hard battery (${BATTERY_HARD.length} problems)

Multi-step logic, probability, and number theory — headroom for models that clear the classic set.

${table(BATTERY_HARD)}
`;

const fs = await import("node:fs");
fs.writeFileSync("PROBLEMS.md", md);
console.log(`Wrote PROBLEMS.md (${BATTERY_CLASSIC.length} classic + ${BATTERY_HARD.length} hard)`);
