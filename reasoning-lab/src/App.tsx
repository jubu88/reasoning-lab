import { useEffect, useState } from "react";
import { checkConnection, listModels, type ModelInfo } from "./api/ollama";
import type { AnswerStyle } from "./lib/checker";
import type { FeedbackMode, StopMode } from "./lib/refine";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import BenchmarkView from "./components/BenchmarkView";
import RefineView from "./components/RefineView";
import ResultsView from "./components/ResultsView";
import CodeLabView from "./components/CodeLabView";

export type ViewId = "chat" | "benchmark" | "refine" | "results" | "codelab";

export interface Settings {
  model: string;
  temperature: number;
  think: boolean;
  numCtx?: number;
  /** applies to Benchmark and Refine Lab prompts (Chat is always free-form) */
  answerStyle: AnswerStyle;
}

/** a recorded experiment configuration, loadable into the Refine Lab for live re-runs */
export interface Scenario {
  problemId: string;
  answerStyle: AnswerStyle;
  maxIterations: number;
  stopMode: StopMode;
  feedbackMode: FeedbackMode;
  escalate: boolean;
  revisionTemp: number;
  autoRun?: boolean;
  /** changes every load so the same scenario can be re-applied */
  seq: number;
}

export default function App() {
  const [view, setView] = useState<ViewId>("chat");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    model: "",
    temperature: 0,
    think: false,
    numCtx: 8192,
    answerStyle: "free",
  });
  const [scenario, setScenario] = useState<Scenario | null>(null);

  const loadScenario = (s: Omit<Scenario, "seq">) => {
    // recorded runs were all baseline temp 0, thinking off
    setSettings((prev) => ({ ...prev, answerStyle: s.answerStyle, temperature: 0, think: false }));
    setScenario({ ...s, seq: Date.now() });
    setView("refine");
  };

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const ok = await checkConnection();
      if (!alive) return;
      setConnected(ok);
      if (ok) {
        try {
          const list = await listModels();
          if (!alive) return;
          setModels(list);
          setSettings((s) => (s.model || list.length === 0 ? s : { ...s, model: list[0].name }));
        } catch {
          /* keep previous list */
        }
      }
    };
    refresh();
    const id = setInterval(refresh, 6000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="app">
      <Sidebar
        view={view}
        onViewChange={setView}
        models={models}
        connected={connected}
        settings={settings}
        onSettingsChange={setSettings}
      />
      <main className="main">
        {/* All views stay mounted so their state survives tab switches */}
        <div className={`view ${view === "chat" ? "" : "hidden"}`}>
          <ChatView settings={settings} />
        </div>
        <div className={`view ${view === "benchmark" ? "" : "hidden"}`}>
          <BenchmarkView settings={settings} />
        </div>
        <div className={`view ${view === "refine" ? "" : "hidden"}`}>
          <RefineView settings={settings} scenario={scenario} />
        </div>
        <div className={`view ${view === "results" ? "" : "hidden"}`}>
          <ResultsView onLoadScenario={loadScenario} />
        </div>
        <div className={`view ${view === "codelab" ? "" : "hidden"}`}>
          <CodeLabView settings={settings} />
        </div>
      </main>
    </div>
  );
}
