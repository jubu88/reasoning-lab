// The iterative self-refinement engine.
//
// Core idea (instead of long chain-of-thought in one context): the model answers,
// then gets a FRESH conversation containing only the problem and its previous
// answer, and is asked to re-examine and revise. Each iteration keeps the context
// small, trading context length for repeated passes.

import { chat } from "../api/ollama";
import {
  checkAnswer,
  extractFinal,
  instructionFor,
  normalizeAnswer,
  type AnswerStyle,
  type Problem,
} from "./checker";

export type StopMode = "fixed" | "converge" | "oracle";
export type FeedbackMode = "full-response" | "answer-only";

export interface RefineConfig {
  model: string;
  /** revision rounds after the initial attempt */
  maxIterations: number;
  temperature: number;
  think: boolean;
  numCtx?: number;
  /**
   * fixed     – always run all iterations (honest; final answer = last iteration)
   * converge  – stop early when the answer repeats (honest; no ground truth used)
   * oracle    – stop as soon as the checker passes (demo only; uses ground truth!)
   */
  stopMode: StopMode;
  /** what the model sees of its previous attempt */
  feedbackMode: FeedbackMode;
  /** free: reasoning allowed in responses; direct: bare final answer every round */
  answerStyle: AnswerStyle;
  /** style for revision rounds; set to "free" to escalate a direct baseline into reasoning */
  revisionStyle: AnswerStyle;
  /** temperature for revision rounds; > 0 helps break confidently-wrong lock-in */
  revisionTemperature: number;
}

export interface IterationRecord {
  index: number; // 0 = initial attempt
  promptSent: string;
  content: string;
  thinking: string;
  extracted: string;
  correct: boolean | null; // null when the problem has no checker (custom w/o expected)
  ms: number;
  tokens?: number;
  stoppedBecause?: "max" | "converged" | "oracle-pass";
}

export interface RefineProgress {
  kind: "iteration-start" | "delta" | "iteration-done";
  iteration: number;
  delta?: { content?: string; thinking?: string };
  record?: IterationRecord;
}

function revisionPrompt(
  problemPrompt: string,
  previous: IterationRecord,
  mode: FeedbackMode,
  style: AnswerStyle
): string {
  const prevText =
    mode === "full-response"
      ? previous.content.length > 4000
        ? previous.content.slice(0, 4000) + "\n[...truncated]"
        : previous.content
      : `FINAL: ${previous.extracted}`;

  return (
    "You previously attempted to solve a problem. Your job now is to carefully review that attempt and produce a final answer.\n\n" +
    `PROBLEM:\n${problemPrompt}\n\n` +
    `YOUR PREVIOUS ATTEMPT:\n${prevText}\n\n` +
    "INSTRUCTIONS:\n" +
    "1. Re-read the problem very carefully. Watch for traps, irrelevant details, and wording tricks.\n" +
    "2. Solve the problem yourself from scratch.\n" +
    "3. Compare your result with the previous attempt. If they differ, work out which one is actually right.\n" +
    "4. State your final answer." +
    instructionFor(style)
  );
}

export async function runRefinement(
  problem: Problem,
  config: RefineConfig,
  onProgress: (p: RefineProgress) => void,
  signal?: AbortSignal
): Promise<IterationRecord[]> {
  const records: IterationRecord[] = [];
  const hasChecker =
    problem.expected !== undefined || (problem.expectedKeywords?.length ?? 0) > 0;

  for (let i = 0; i <= config.maxIterations; i++) {
    const prompt =
      i === 0
        ? problem.prompt + instructionFor(config.answerStyle)
        : revisionPrompt(problem.prompt, records[i - 1], config.feedbackMode, config.revisionStyle);

    onProgress({ kind: "iteration-start", iteration: i });
    const t0 = performance.now();
    const result = await chat({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      think: config.think,
      temperature: i === 0 ? config.temperature : config.revisionTemperature,
      numCtx: config.numCtx,
      signal,
      onDelta: (delta) => onProgress({ kind: "delta", iteration: i, delta }),
    });

    const extracted = extractFinal(result.content);
    const verdict = hasChecker ? checkAnswer(problem, result.content) : null;
    const record: IterationRecord = {
      index: i,
      promptSent: prompt,
      content: result.content,
      thinking: result.thinking,
      extracted,
      correct: verdict ? verdict.pass : null,
      ms: performance.now() - t0,
      tokens: result.stats.evalCount,
    };

    // stopping rules
    if (i === config.maxIterations) {
      record.stoppedBecause = "max";
    } else if (config.stopMode === "oracle" && verdict?.pass) {
      record.stoppedBecause = "oracle-pass";
    } else if (
      config.stopMode === "converge" &&
      i > 0 &&
      normalizeAnswer(extracted) === normalizeAnswer(records[i - 1].extracted) &&
      normalizeAnswer(extracted) !== ""
    ) {
      record.stoppedBecause = "converged";
    }

    records.push(record);
    onProgress({ kind: "iteration-done", iteration: i, record });
    if (record.stoppedBecause) break;
  }

  return records;
}
