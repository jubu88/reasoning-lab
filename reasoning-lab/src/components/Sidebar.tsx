import type { ModelInfo } from "../api/ollama";
import type { Settings, ViewId } from "../App";

interface Props {
  view: ViewId;
  onViewChange: (v: ViewId) => void;
  models: ModelInfo[];
  connected: boolean;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}

const NAV: { id: ViewId; icon: string; label: string }[] = [
  { id: "chat", icon: "💬", label: "Chat" },
  { id: "benchmark", icon: "🧪", label: "Benchmark" },
  { id: "refine", icon: "🔁", label: "Refine Lab" },
  { id: "results", icon: "📊", label: "Results" },
];

const CTX_OPTIONS = [
  { value: 0, label: "Ollama default" },
  { value: 4096, label: "4K" },
  { value: 8192, label: "8K" },
  { value: 16384, label: "16K" },
];

export default function Sidebar({ view, onViewChange, models, connected, settings, onSettingsChange }: Props) {
  const set = (patch: Partial<Settings>) => onSettingsChange({ ...settings, ...patch });

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">🧠</div>
        <div>
          <div className="brand-name">Reasoning Lab</div>
          <div className="brand-sub">local LLM reasoning workbench</div>
        </div>
      </div>

      <div className="conn">
        <span className={`conn-dot ${connected ? "ok" : ""}`} />
        {connected ? "Ollama connected" : "Ollama not reachable on :11434"}
      </div>

      <nav className="nav">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`nav-btn ${view === n.id ? "active" : ""}`}
            onClick={() => onViewChange(n.id)}
          >
            <span>{n.icon}</span> {n.label}
          </button>
        ))}
      </nav>

      <div className="side-section">
        <div className="side-label">Model</div>
        <select value={settings.model} onChange={(e) => set({ model: e.target.value })}>
          {models.length === 0 && <option value="">no models found</option>}
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
              {m.parameterSize ? ` · ${m.parameterSize}` : ""}
              {m.remote ? " · cloud" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="side-section">
        <div className="side-label">Generation</div>

        <div className="toggle-row">
          <span>
            Thinking mode
            <small>built-in chain-of-thought</small>
          </span>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.think}
              onChange={(e) => set({ think: e.target.checked })}
            />
            <span className="slider" />
          </label>
        </div>

        <div className="toggle-row">
          <span>
            Direct answers
            <small>forbid written-out reasoning (Benchmark &amp; Refine)</small>
          </span>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.answerStyle === "direct"}
              onChange={(e) => set({ answerStyle: e.target.checked ? "direct" : "free" })}
            />
            <span className="slider" />
          </label>
        </div>

        <div className="field">
          <div className="field-label">
            <span>Temperature</span>
            <b>{settings.temperature.toFixed(1)}</b>
          </div>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.1}
            value={settings.temperature}
            onChange={(e) => set({ temperature: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <div className="field-label">
            <span>Context window</span>
          </div>
          <select
            value={settings.numCtx ?? 0}
            onChange={(e) => set({ numCtx: Number(e.target.value) || undefined })}
          >
            {CTX_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="sidebar-footer">
        Benchmark &amp; Refine Lab work best with temperature 0 and thinking off — that's the
        baseline we're trying to improve through iteration.
      </div>
    </aside>
  );
}
