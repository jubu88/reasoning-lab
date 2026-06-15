import { useEffect, useRef, useState } from "react";
import type { Settings } from "../App";
import { createProject, listProjects, runAgent, type AgentProgress, type AgentStep, type ProjectInfo } from "../lib/codeagent";

const BENCHMARKS: { label: string; task: string }[] = [
  {
    label: "TODO list",
    task: "A to-do list app: an input box and Add button to add tasks, each task shown with a checkbox to mark it done (strike-through when done) and a delete button. Show a count of remaining tasks. Clean, modern styling.",
  },
  {
    label: "Unit converter",
    task: "A length unit converter: a number input, two dropdowns (meters, feet, inches, kilometers, miles), and a live-updating converted result. Convert as the user types. Clean styling.",
  },
  {
    label: "Tip calculator",
    task: "A tip calculator: inputs for bill amount and tip percent (with quick 10/15/20% buttons) and number of people, showing tip amount, total, and per-person amount, updating live. Clean styling.",
  },
];

interface ConsoleMsg {
  type: string;
  text: string;
}

export default function CodeLabView({ settings }: { settings: Settings }) {
  const [mode, setMode] = useState<"benchmark" | "freeform">("benchmark");
  const [benchIdx, setBenchIdx] = useState(0);
  const [freeform, setFreeform] = useState("");
  const [maxIterations, setMaxIterations] = useState(8);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [live, setLive] = useState<AgentProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<{ path: string; bytes: number }[]>([]);
  const [previewKey, setPreviewKey] = useState(0);
  const [hasIndex, setHasIndex] = useState(false);
  const [consoleMsgs, setConsoleMsgs] = useState<ConsoleMsg[]>([]);
  const [project, setProject] = useState<string>("");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [, setTick] = useState(0);
  const [viewer, setViewer] = useState<{ path: string; content?: string; image?: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const iterStartRef = useRef<number>(0);
  const buildStartRef = useRef<number>(0);
  const logRef = useRef<HTMLDivElement>(null);

  // one ticker drives every elapsed display from render-time Date.now(), so it
  // keeps counting even through long buffered generations where Ollama streams
  // nothing (the old per-iteration counter could appear frozen)
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [busy]);

  // collect runtime errors/logs postMessaged from the sandboxed preview iframe
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data && e.data.__codelab) {
        setConsoleMsgs((m) => [...m, { type: e.data.type, text: String(e.data.text).slice(0, 300) }].slice(-50));
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps]);

  const loadProjects = async () => {
    try {
      setProjects(await listProjects());
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    loadProjects();
  }, []);

  const refreshFiles = async (pid: string) => {
    if (!pid) return;
    try {
      const r = await (await fetch(`/codelab/api/list?project=${encodeURIComponent(pid)}`)).json();
      const list = r.files ?? [];
      setFiles(list);
      setHasIndex(list.some((f: any) => f.path === "index.html"));
    } catch {
      /* ignore */
    }
  };

  // selecting a past project from the dropdown loads it read-only into the preview
  const openProject = async (pid: string) => {
    setProject(pid);
    setSteps([]);
    setConsoleMsgs([]);
    setLive(null);
    setViewer(null);
    await refreshFiles(pid);
    setPreviewKey((k) => k + 1);
  };

  // click a file to view its contents (text) or render it (image)
  const openFile = async (pid: string, path: string) => {
    if (/\.(png|jpe?g|webp|gif|svg)$/i.test(path)) {
      setViewer({ path, image: true });
      return;
    }
    setViewer({ path, content: "loading…" });
    try {
      const r = await (await fetch(`/codelab/api/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: pid, path }) })).json();
      setViewer({ path, content: r.ok ? r.content : `error: ${r.error}` });
    } catch (e: any) {
      setViewer({ path, content: String(e?.message ?? e) });
    }
  };

  const task = mode === "benchmark" ? BENCHMARKS[benchIdx].task : freeform.trim();

  const run = async (extraErrors?: string[]) => {
    if (!task || busy || !settings.model) return;
    setError("");
    setBusy(true);
    setLive(null);
    setViewer(null);
    iterStartRef.current = Date.now();
    buildStartRef.current = Date.now();
    // a fresh build gets its OWN project folder (no overwriting past work);
    // "Fix errors" re-runs in the current project
    let pid = project;
    if (!extraErrors) {
      setSteps([]);
      setConsoleMsgs([]);
      try {
        pid = await createProject(mode === "benchmark" ? BENCHMARKS[benchIdx].label : task);
      } catch (e: any) {
        setError(String(e?.message ?? e));
        setBusy(false);
        return;
      }
      setProject(pid);
      setFiles([]);
      setHasIndex(false);
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await runAgent(
        {
          model: settings.model,
          task,
          project: pid,
          maxIterations,
          temperature: settings.temperature,
          consoleErrors: extraErrors,
        },
        (step) => {
          setSteps((s) => [...s, step]);
          setLive(null);
          iterStartRef.current = Date.now();
          if (step.toolCalls.some((t) => t.name === "write_file")) {
            refreshFiles(pid);
            setPreviewKey((k) => k + 1);
          }
        },
        (p) => setLive(p),
        ctrl.signal
      );
      await refreshFiles(pid);
      await loadProjects();
      setPreviewKey((k) => k + 1);
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const errorMsgs = consoleMsgs.filter((m) => m.type === "error");
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const iterElapsed = busy ? Math.max(0, Math.round((Date.now() - iterStartRef.current) / 1000)) : 0;
  const buildElapsed = busy ? Math.max(0, Math.round((Date.now() - buildStartRef.current) / 1000)) : 0;

  return (
    <>
      <div className="view-header">
        <span className="view-title">Code Lab</span>
        <span className="view-desc">
          Let <b>{settings.model || "…"}</b> build a static web app with tools (files jailed to the
          workspace, web fetch/search, sandboxed preview). No code runs on your machine.
        </span>
      </div>
      <div className="view-body">
        <div className="codelab-grid">
          <div className="codelab-left">
            <div className="card">
              <div className="card-title">Task</div>
              <div className="seg" style={{ marginBottom: 10 }}>
                <button className={mode === "benchmark" ? "seg-on" : ""} onClick={() => setMode("benchmark")} disabled={busy}>
                  Benchmark
                </button>
                <button className={mode === "freeform" ? "seg-on" : ""} onClick={() => setMode("freeform")} disabled={busy}>
                  Freeform
                </button>
              </div>
              {mode === "benchmark" ? (
                <select value={benchIdx} onChange={(e) => setBenchIdx(Number(e.target.value))} disabled={busy} style={{ width: "100%" }}>
                  {BENCHMARKS.map((b, i) => (
                    <option key={b.label} value={i}>
                      {b.label}
                    </option>
                  ))}
                </select>
              ) : (
                <textarea
                  rows={4}
                  placeholder="Describe the web app to build…"
                  value={freeform}
                  onChange={(e) => setFreeform(e.target.value)}
                  disabled={busy}
                  style={{ width: "100%" }}
                />
              )}
              <div className="prob-prompt" style={{ maxWidth: "none", marginTop: 8 }}>
                {task || "—"}
              </div>

              <div className="field" style={{ marginTop: 12 }}>
                <div className="field-label">
                  <span>Max iterations</span>
                  <b>{maxIterations}</b>
                </div>
                <input type="range" min={3} max={15} value={maxIterations} onChange={(e) => setMaxIterations(Number(e.target.value))} disabled={busy} />
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                {busy ? (
                  <button className="btn danger" onClick={() => abortRef.current?.abort()}>
                    ■ Stop
                  </button>
                ) : (
                  <button className="btn primary" onClick={() => run()} disabled={!task || !settings.model}>
                    ▶ Build it
                  </button>
                )}
                {!busy && errorMsgs.length > 0 && hasIndex && (
                  <button className="btn" onClick={() => run(errorMsgs.map((m) => m.text))} title="Feed the runtime errors back to the model to fix">
                    ↻ Fix {errorMsgs.length} error{errorMsgs.length === 1 ? "" : "s"}
                  </button>
                )}
              </div>
              {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-title">Projects {projects.length > 0 ? `(${projects.length})` : ""}</div>
              <select
                value={project}
                onChange={(e) => openProject(e.target.value)}
                disabled={busy}
                style={{ width: "100%" }}
              >
                <option value="">— select a past build —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} ({p.files} files{p.hasIndex ? "" : ", no index"})
                  </option>
                ))}
              </select>
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                Files {files.length > 0 ? `(${files.length})` : ""}
                {project && files.length > 0 && (
                  <a className="btn small" style={{ marginLeft: "auto" }} href={`/codelab/api/export?project=${encodeURIComponent(project)}`} download>
                    ⤓ zip
                  </a>
                )}
              </div>
              {files.length === 0 ? (
                <div className="prob-prompt">no files yet</div>
              ) : (
                files.map((f) => (
                  <div key={f.path} className="file-row file-row-click" onClick={() => openFile(project, f.path)} title="view file">
                    <span className="file-name">{f.path}</span>
                    <span className="file-bytes">{f.bytes} B</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="codelab-mid">
            <div className="card-title" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
              Agent log
              {busy && (
                <>
                  <span className="chip">⏱ {fmt(buildElapsed)} total</span>
                  <span className="spinner" />
                </>
              )}
            </div>
            <div className="agent-log" ref={logRef}>
              {steps.length === 0 && !busy && <div className="prob-prompt">The model's tool calls will appear here.</div>}
              {steps.map((s, i) => (
                <div key={i} className="agent-step">
                  <div className="agent-step-head">
                    iteration {s.iteration}{s.tokens ? ` · ${s.tokens} tok` : ""}
                    {s.truncated && <span className="badge fail" style={{ marginLeft: 8 }}>⚠ hit token cap — write may be truncated</span>}
                  </div>
                  {s.message && <div className="agent-msg">{s.message}</div>}
                  {s.toolCalls.map((t, j) => (
                    <div key={j} className={`tool-call ${t.result.startsWith("error") ? "err" : ""}`}>
                      <span className="tool-name">{t.name}</span>
                      {t.name === "write_file" && <span className="tool-arg">{t.args?.path}</span>}
                      {t.name === "get_design_system" && <span className="tool-arg">{t.args?.style}</span>}
                      {t.name === "get_icon" && <span className="tool-arg">{t.args?.name}</span>}
                      {t.name === "generate_image" && <span className="tool-arg">{t.args?.path}</span>}
                      {t.name === "web_search" && <span className="tool-arg">{t.args?.query}</span>}
                      {t.name === "web_fetch" && <span className="tool-arg">{t.args?.url}</span>}
                      {t.name === "done" && <span className="tool-arg">{t.args?.summary}</span>}
                      <span className="tool-result">{t.result.slice(0, 80)}</span>
                    </div>
                  ))}
                </div>
              ))}
              {busy && (
                <div className="agent-step live">
                  <div className="agent-step-head">
                    iteration {live?.iteration ?? steps.length} ·{" "}
                    {live && live.tokens > 1 ? (
                      <>generating <b>{live.tokens}</b> tok · {iterElapsed}s</>
                    ) : (
                      <>working… <b>{iterElapsed}s</b> (model is generating; output may be buffered)</>
                    )}
                    <span className="spinner" style={{ marginLeft: 6 }} />
                  </div>
                  {live && <div className="agent-msg live-text">{live.text.slice(-1200)}</div>}
                </div>
              )}
            </div>
          </div>

          <div className="codelab-right">
            <div className="card-title" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
              Preview
              {hasIndex && (
                <button className="btn small" onClick={() => setPreviewKey((k) => k + 1)}>
                  ↻ reload
                </button>
              )}
            </div>
            <div className="preview-frame">
              {hasIndex && project ? (
                <iframe
                  key={previewKey}
                  title="preview"
                  src={`/codelab/preview/${encodeURIComponent(project)}/index.html?v=${previewKey}`}
                  sandbox="allow-scripts allow-forms allow-modals allow-popups"
                />
              ) : (
                <div className="preview-empty">no index.html yet</div>
              )}
            </div>
            {consoleMsgs.length > 0 && (
              <div className="card" style={{ marginTop: 10 }}>
                <div className="card-title">
                  Console {errorMsgs.length > 0 && <span className="badge fail" style={{ marginLeft: 6 }}>{errorMsgs.length} error{errorMsgs.length === 1 ? "" : "s"}</span>}
                </div>
                <div className="console-out">
                  {consoleMsgs.slice(-12).map((m, i) => (
                    <div key={i} className={`console-line ${m.type}`}>
                      <span className="console-type">{m.type}</span> {m.text}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {viewer && (
          <div className="file-modal" onClick={() => setViewer(null)}>
            <div className="file-modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="file-modal-head">
                <span className="file-name">{viewer.path}</span>
                <button className="btn small" onClick={() => setViewer(null)}>✕ close</button>
              </div>
              <div className="file-modal-body">
                {viewer.image ? (
                  <img src={`/codelab/preview/${encodeURIComponent(project)}/${viewer.path}?v=${previewKey}`} alt={viewer.path} style={{ maxWidth: "100%" }} />
                ) : (
                  <pre>{viewer.content}</pre>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
