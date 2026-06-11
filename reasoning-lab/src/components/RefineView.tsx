import { useEffect, useRef, useState } from "react";
import type { Settings } from "../App";
import type { CheckType, Problem } from "../lib/checker";
import { PROBLEMS } from "../lib/problems";
import {
  runRefinement,
  type FeedbackMode,
  type IterationRecord,
  type StopMode,
} from "../lib/refine";

export default function RefineView({ settings }: { settings: Settings }) {
  // default to the problem where direct-mode iteration demonstrably self-corrects
  const [selectedId, setSelectedId] = useState("weekday-feb14");
  const [customPrompt, setCustomPrompt] = useState("");
  const [customExpected, setCustomExpected] = useState("");
  const [customType, setCustomType] = useState<CheckType | "none">("word");

  const [maxIterations, setMaxIterations] = useState(4);
  const [stopMode, setStopMode] = useState<StopMode>("converge");
  const [feedbackMode, setFeedbackMode] = useState<FeedbackMode>("full-response");
  const [escalate, setEscalate] = useState(false);
  const [revisionTemp, setRevisionTemp] = useState(0);

  const [records, setRecords] = useState<IterationRecord[]>([]);
  const [live, setLive] = useState<{ iteration: number; content: string; thinking: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const liveContentRef = useRef<HTMLDivElement>(null);
  const liveThinkingRef = useRef<HTMLDivElement>(null);

  // results belong to one problem — switching problems aborts any run and clears them
  useEffect(() => {
    abortRef.current?.abort();
    setRecords([]);
    setError("");
  }, [selectedId]);

  // keep the streaming card scrolled to the newest tokens during long generations
  useEffect(() => {
    for (const ref of [liveContentRef, liveThinkingRef]) {
      const el = ref.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [live]);

  const isCustom = selectedId === "custom";
  const suiteProblem = PROBLEMS.find((p) => p.id === selectedId);

  const buildProblem = (): Problem | null => {
    if (!isCustom) return suiteProblem ?? null;
    if (!customPrompt.trim()) return null;
    const hasCheck = customType !== "none" && customExpected.trim() !== "";
    return {
      id: "custom",
      label: "Custom problem",
      category: "custom",
      prompt: customPrompt.trim(),
      type: hasCheck ? (customType as CheckType) : "word",
      expected: hasCheck
        ? customType === "numeric"
          ? Number(customExpected)
          : customExpected.trim()
        : undefined,
      expectedDisplay: hasCheck ? customExpected.trim() : "(no checker)",
    };
  };

  const problem = buildProblem();

  const run = async () => {
    if (!problem || busy || !settings.model) return;
    setError("");
    setRecords([]);
    setLive(null);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await runRefinement(
        problem,
        {
          model: settings.model,
          maxIterations,
          temperature: settings.temperature,
          think: settings.think,
          numCtx: settings.numCtx,
          stopMode,
          feedbackMode,
          answerStyle: settings.answerStyle,
          revisionStyle: escalate ? "free" : settings.answerStyle,
          revisionTemperature: revisionTemp,
        },
        (p) => {
          if (p.kind === "iteration-start") {
            setLive({ iteration: p.iteration, content: "", thinking: "" });
          } else if (p.kind === "delta") {
            setLive((prev) =>
              prev
                ? {
                    ...prev,
                    content: prev.content + (p.delta?.content ?? ""),
                    thinking: prev.thinking + (p.delta?.thinking ?? ""),
                  }
                : prev
            );
          } else if (p.kind === "iteration-done" && p.record) {
            setRecords((rs) => [...rs, p.record!]);
            setLive(null);
          }
        },
        ctrl.signal
      );
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
      setLive(null);
      abortRef.current = null;
    }
  };

  const baseline = records.find((r) => r.index === 0);
  const final = records.length > 0 ? records[records.length - 1] : undefined;
  const finished = !busy && records.length > 0;
  const verdictKind =
    baseline?.correct === false && final?.correct === true
      ? "improved"
      : baseline?.correct === true && final?.correct === false
        ? "regressed"
        : "unchanged";

  return (
    <>
      <div className="view-header">
        <span className="view-title">Refine Lab</span>
        <span className="view-desc">
          Iterative self-refinement: each round, the model gets a <b>fresh context</b> with only the
          problem + its previous attempt, and must re-examine and revise.{" "}
          {settings.answerStyle === "direct" ? "(direct answers — no visible reasoning)" : "(free-form answers)"}
        </span>
      </div>
      <div className="view-body">
        <div className="refine-grid">
          <div className="refine-config">
            <div className="card">
              <div className="card-title">Problem</div>
              <div className="field" style={{ marginBottom: 10 }}>
                <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                  {PROBLEMS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.failsOneShot ? "⚠ " : ""}
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">✏️ Custom problem…</option>
                </select>
              </div>
              {isCustom ? (
                <>
                  <div className="field" style={{ marginBottom: 10 }}>
                    <div className="field-label">
                      <span>Problem text</span>
                    </div>
                    <textarea
                      rows={4}
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      placeholder="State the problem…"
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 10 }}>
                    <div className="field-label">
                      <span>Expected answer (optional)</span>
                    </div>
                    <input
                      type="text"
                      value={customExpected}
                      onChange={(e) => setCustomExpected(e.target.value)}
                      placeholder="e.g. 42"
                    />
                  </div>
                  <div className="field">
                    <div className="field-label">
                      <span>Answer type</span>
                    </div>
                    <select value={customType} onChange={(e) => setCustomType(e.target.value as CheckType | "none")}>
                      <option value="numeric">number</option>
                      <option value="word">word / phrase</option>
                      <option value="none">no checker</option>
                    </select>
                  </div>
                </>
              ) : (
                suiteProblem && (
                  <>
                    <div className="prob-prompt" style={{ maxWidth: "none" }}>
                      {suiteProblem.prompt}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <span className="chip">expected: {suiteProblem.expectedDisplay}</span>
                    </div>
                  </>
                )
              )}
            </div>

            <div className="card">
              <div className="card-title">Loop settings</div>
              <div className="field" style={{ marginBottom: 12 }}>
                <div className="field-label">
                  <span>Max revision rounds</span>
                  <b>{maxIterations}</b>
                </div>
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={1}
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(Number(e.target.value))}
                />
              </div>

              <div className="field" style={{ marginBottom: 12 }}>
                <div className="field-label">
                  <span>Stopping rule</span>
                </div>
                <div className="radio-group">
                  <label className="radio-item">
                    <input
                      type="radio"
                      checked={stopMode === "converge"}
                      onChange={() => setStopMode("converge")}
                    />
                    <span>
                      Converge
                      <small>stop when the answer repeats — honest, no ground truth used</small>
                    </span>
                  </label>
                  <label className="radio-item">
                    <input type="radio" checked={stopMode === "fixed"} onChange={() => setStopMode("fixed")} />
                    <span>
                      Fixed rounds
                      <small>always run every round, keep the last answer</small>
                    </span>
                  </label>
                  <label className="radio-item">
                    <input type="radio" checked={stopMode === "oracle"} onChange={() => setStopMode("oracle")} />
                    <span>
                      Oracle stop
                      <small>stop when correct — uses the answer key, demo only</small>
                    </span>
                  </label>
                </div>
              </div>

              <div className="field" style={{ marginBottom: 12 }}>
                <div className="field-label">
                  <span>Escalation</span>
                </div>
                <div className="toggle-row">
                  <span>
                    Reason in revisions
                    <small>free-form reasoning in revision rounds, even when the baseline is direct</small>
                  </span>
                  <label className="switch">
                    <input type="checkbox" checked={escalate} onChange={(e) => setEscalate(e.target.checked)} />
                    <span className="slider" />
                  </label>
                </div>
              </div>

              <div className="field" style={{ marginBottom: 12 }}>
                <div className="field-label">
                  <span>Revision temperature</span>
                  <b>{revisionTemp.toFixed(1)}</b>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.1}
                  value={revisionTemp}
                  onChange={(e) => setRevisionTemp(Number(e.target.value))}
                />
              </div>

              <div className="field">
                <div className="field-label">
                  <span>Feedback shown to the model</span>
                </div>
                <div className="radio-group">
                  <label className="radio-item">
                    <input
                      type="radio"
                      checked={feedbackMode === "full-response"}
                      onChange={() => setFeedbackMode("full-response")}
                    />
                    <span>
                      Full previous response
                      <small>model can spot flaws in its own reasoning</small>
                    </span>
                  </label>
                  <label className="radio-item">
                    <input
                      type="radio"
                      checked={feedbackMode === "answer-only"}
                      onChange={() => setFeedbackMode("answer-only")}
                    />
                    <span>
                      Final answer only
                      <small>forces a fresh derivation, minimal context</small>
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {busy ? (
              <button className="btn danger" onClick={() => abortRef.current?.abort()}>
                ■ Stop loop
              </button>
            ) : (
              <button className="btn primary" onClick={run} disabled={!problem || !settings.model}>
                ▶ Run refinement loop
              </button>
            )}
            {error && <div className="error-box">{error}</div>}
          </div>

          <div className="refine-results">
            {finished && baseline && final && baseline.correct !== null && (
              <div className={`verdict-banner ${verdictKind}`}>
                {verdictKind === "improved" && <b>✓ Refinement fixed it</b>}
                {verdictKind === "regressed" && <b>✗ Refinement broke it</b>}
                {verdictKind === "unchanged" &&
                  (final.correct ? <b>✓ Correct throughout</b> : <b>✗ Still wrong</b>)}
                <span>
                  baseline: <b>{baseline.extracted || "—"}</b> ({baseline.correct ? "correct" : "wrong"}) →
                  after {records.length - 1} round{records.length - 1 === 1 ? "" : "s"}:{" "}
                  <b>{final.extracted || "—"}</b> ({final.correct ? "correct" : "wrong"})
                </span>
              </div>
            )}

            {records.length === 0 && !live && (
              <div className="empty-hint">
                Pick a problem the model fails one-shot (see Benchmark), then run the loop
                <br />
                to see whether re-examining its own answer gets it there.
              </div>
            )}

            {records.map((r) => (
              <IterationCard key={r.index} record={r} />
            ))}

            {live && (
              <div className="iter-card">
                <div className="iter-head">
                  <span className="iter-num">
                    {live.iteration === 0 ? "Attempt 0 · baseline" : `Revision ${live.iteration}`}
                  </span>
                  <span className="badge running">
                    <span className="spinner" /> generating
                  </span>
                </div>
                <div className="iter-body">
                  {live.thinking && (
                    <div className="thinking-block" ref={liveThinkingRef}>
                      <div className="thinking-label">thinking…</div>
                      {live.thinking}
                    </div>
                  )}
                  <div className="iter-content" ref={liveContentRef}>
                    {live.content || "…"}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function IterationCard({ record }: { record: IterationRecord }) {
  const cls = record.correct === null ? "" : record.correct ? "correct" : "incorrect";
  return (
    <div className={`iter-card ${cls}`}>
      <div className="iter-head">
        <span className="iter-num">
          {record.index === 0 ? "Attempt 0 · baseline" : `Revision ${record.index}`}
        </span>
        {record.correct !== null &&
          (record.correct ? (
            <span className="badge pass">✓ correct</span>
          ) : (
            <span className="badge fail">✗ wrong</span>
          ))}
        {record.stoppedBecause === "converged" && <span className="chip">stopped: answer converged</span>}
        {record.stoppedBecause === "oracle-pass" && <span className="chip">stopped: oracle says correct</span>}
        <span className="iter-extracted">{record.extracted || "—"}</span>
      </div>
      <div className="iter-body">
        {record.thinking && (
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--purple)", marginBottom: 6 }}>
              💭 thinking
            </summary>
            <div className="thinking-block">{record.thinking}</div>
          </details>
        )}
        <div className="iter-content">{record.content}</div>
        <details className="iter-prompt">
          <summary>prompt sent this round</summary>
          <div className="full-response">{record.promptSent}</div>
        </details>
        <div className="iter-meta">
          <span>{(record.ms / 1000).toFixed(1)}s</span>
          {record.tokens && <span>{record.tokens} tokens</span>}
        </div>
      </div>
    </div>
  );
}
