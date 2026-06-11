import { useRef, useState } from "react";
import { chat } from "../api/ollama";
import { checkAnswer, instructionFor, type Problem } from "../lib/checker";
import { PROBLEMS } from "../lib/problems";
import type { Settings } from "../App";

type RowStatus = "idle" | "running" | "pass" | "fail" | "error";

interface RowResult {
  status: RowStatus;
  extracted?: string;
  content?: string;
  thinking?: string;
  ms?: number;
  error?: string;
}

export default function BenchmarkView({ settings }: { settings: Settings }) {
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const setRow = (id: string, r: RowResult) => setResults((prev) => ({ ...prev, [id]: r }));

  // `snap` is the settings snapshot taken when the run started — changing the
  // sidebar mid-run must not mix configurations within one result set
  const runOne = async (problem: Problem, signal: AbortSignal, snap: Settings) => {
    setRow(problem.id, { status: "running" });
    const t0 = performance.now();
    try {
      const result = await chat({
        model: snap.model,
        messages: [{ role: "user", content: problem.prompt + instructionFor(snap.answerStyle) }],
        think: snap.think,
        temperature: snap.temperature,
        numCtx: snap.numCtx,
        seed: 7,
        signal,
      });
      const verdict = checkAnswer(problem, result.content);
      setRow(problem.id, {
        status: verdict.pass ? "pass" : "fail",
        extracted: verdict.extracted,
        content: result.content,
        thinking: result.thinking,
        ms: performance.now() - t0,
      });
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setRow(problem.id, { status: "idle" });
        throw e;
      }
      setRow(problem.id, { status: "error", error: String(e?.message ?? e) });
    }
  };

  const runMany = async (problems: Problem[]) => {
    if (running || !settings.model) return;
    setRunning(true);
    const snap = settings;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      for (const p of problems) {
        if (ctrl.signal.aborted) break;
        await runOne(p, ctrl.signal, snap);
      }
    } catch {
      /* aborted */
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const failedProblems = PROBLEMS.filter((p) => results[p.id]?.status === "fail");
  const doneCount = PROBLEMS.filter((p) => ["pass", "fail"].includes(results[p.id]?.status ?? "")).length;
  const passCount = PROBLEMS.filter((p) => results[p.id]?.status === "pass").length;

  return (
    <>
      <div className="view-header">
        <span className="view-title">Benchmark</span>
        <span className="view-desc">
          One-shot accuracy of <b>{settings.model || "…"}</b> on {PROBLEMS.length} trick / reasoning
          problems ({settings.think ? "thinking on" : "thinking off"},{" "}
          {settings.answerStyle === "direct" ? "direct answers" : "free-form"}, temp{" "}
          {settings.temperature.toFixed(1)})
        </span>
      </div>
      <div className="view-body">
        <div className="bench-toolbar">
          <button className="btn primary" onClick={() => runMany(PROBLEMS)} disabled={running || !settings.model}>
            {running ? <span className="spinner" /> : "▶"} Run all
          </button>
          <button
            className="btn"
            onClick={() => runMany(failedProblems)}
            disabled={running || failedProblems.length === 0}
          >
            Re-run failures ({failedProblems.length})
          </button>
          {running && (
            <button className="btn danger" onClick={() => abortRef.current?.abort()}>
              ■ Stop
            </button>
          )}
          <div className="bench-summary">
            {doneCount > 0 && (
              <>
                <span className="badge pass">✓ {passCount}</span>
                <span className="badge fail">✗ {doneCount - passCount}</span>
                <span className="chip">
                  {doneCount}/{PROBLEMS.length} run
                </span>
              </>
            )}
          </div>
        </div>

        <table className="bench">
          <thead>
            <tr>
              <th style={{ width: "42%" }}>Problem</th>
              <th>Category</th>
              <th>Expected</th>
              <th>Model answer</th>
              <th>Result</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {PROBLEMS.map((p) => {
              const r = results[p.id] ?? { status: "idle" as RowStatus };
              return (
                <tr key={p.id}>
                  <td>
                    <div className="prob-label">{p.label}</div>
                    <div className="prob-prompt">{p.prompt}</div>
                    {r.content && (
                      <details className="row-details">
                        <summary>full response</summary>
                        {r.thinking && (
                          <div className="full-response" style={{ fontStyle: "italic", color: "var(--dim)" }}>
                            {r.thinking}
                          </div>
                        )}
                        <div className="full-response">{r.content}</div>
                      </details>
                    )}
                  </td>
                  <td>
                    <span className="chip">{p.category}</span>
                    {p.failsOneShot && (
                      <div style={{ marginTop: 4 }}>
                        <span className="chip" style={{ color: "var(--yellow)", borderColor: "var(--yellow)" }}>
                          ⚠ fails: {p.failsOneShot.join(" + ")}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="bench-expected">{p.expectedDisplay}</td>
                  <td className="bench-answer">
                    {r.status === "error" ? (
                      <span style={{ color: "var(--red)" }}>{r.error?.slice(0, 80)}</span>
                    ) : (
                      r.extracted ?? "—"
                    )}
                  </td>
                  <td>
                    {r.status === "idle" && <span className="badge neutral">idle</span>}
                    {r.status === "running" && (
                      <span className="badge running">
                        <span className="spinner" /> running
                      </span>
                    )}
                    {r.status === "pass" && <span className="badge pass">✓ pass {r.ms ? `· ${(r.ms / 1000).toFixed(1)}s` : ""}</span>}
                    {r.status === "fail" && <span className="badge fail">✗ fail {r.ms ? `· ${(r.ms / 1000).toFixed(1)}s` : ""}</span>}
                    {r.status === "error" && <span className="badge fail">error</span>}
                  </td>
                  <td>
                    <button
                      className="btn small"
                      disabled={running || !settings.model}
                      onClick={() => runMany([p])}
                    >
                      Run
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
