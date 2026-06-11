// Answer extraction and correctness checking, shared by Benchmark and Refine Lab.

export type CheckType = "numeric" | "word" | "keywords";

export interface Problem {
  id: string;
  label: string;
  category: string;
  prompt: string;
  type: CheckType;
  /** numeric: the number; word: substring that must appear in the FINAL line */
  expected?: number | string;
  /** word type: substring that must NOT appear in the FINAL line */
  forbidden?: string;
  /** keywords type: pass if ANY group has ALL its keywords in the searched text */
  expectedKeywords?: string[][];
  /** keywords type: search only the FINAL line (default) or the full response */
  keywordsScope?: "final" | "full";
  /** human-readable expected answer for display */
  expectedDisplay: string;
  /** answer styles in which gemma4:latest (8B, temp 0, thinking off) fails this one-shot */
  failsOneShot?: AnswerStyle[];
}

export const FORMAT_INSTR =
  '\n\nEnd your response with exactly one line:\nFINAL: <your answer>\nwhere <your answer> is just the answer itself (a number, a word, or a short phrase).';

export const DIRECT_INSTR =
  "\n\nAnswer with ONLY one line in exactly this form:\nFINAL: <your answer>\nDo not explain. Do not show any working or reasoning. Output nothing except that single line.";

/** free: the model may write out its reasoning; direct: final answer only, no visible reasoning */
export type AnswerStyle = "free" | "direct";

export function instructionFor(style: AnswerStyle): string {
  return style === "direct" ? DIRECT_INSTR : FORMAT_INSTR;
}

export function extractFinal(text: string): string {
  const matches = [...text.matchAll(/FINAL:\s*(.+)/gi)];
  if (matches.length > 0) return matches[matches.length - 1][1].trim();
  const lines = text.trim().split("\n").filter((l) => l.trim());
  return lines.length ? lines[lines.length - 1].trim() : "";
}

export interface Verdict {
  pass: boolean;
  extracted: string;
}

export function checkAnswer(problem: Problem, fullText: string): Verdict {
  const finalLine = extractFinal(fullText);
  const lower = finalLine.toLowerCase();
  const fullLower = fullText.toLowerCase();

  if (problem.type === "numeric") {
    const m = lower.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    const num = m ? Number(m[0]) : NaN;
    return { pass: num === problem.expected, extracted: finalLine };
  }
  if (problem.type === "word") {
    const expected = String(problem.expected).toLowerCase();
    const pass =
      lower.includes(expected) &&
      (!problem.forbidden || !lower.includes(problem.forbidden.toLowerCase()));
    return { pass, extracted: finalLine };
  }
  // keywords — searching the whole response is prone to false positives (a correct
  // keyword can appear inside wrong reasoning), so default to the FINAL line
  const hay = problem.keywordsScope === "full" ? fullLower : lower;
  const pass = (problem.expectedKeywords ?? []).some((group) =>
    group.every((kw) => hay.includes(kw.toLowerCase()))
  );
  return { pass, extracted: finalLine };
}

/** Normalize an extracted answer so convergence detection isn't fooled by punctuation. */
export function normalizeAnswer(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9.\- ]/g, "").replace(/\s+/g, " ").trim();
}
