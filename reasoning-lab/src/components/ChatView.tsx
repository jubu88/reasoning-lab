import { useEffect, useRef, useState } from "react";
import { chat, type GenStats } from "../api/ollama";
import {
  DIRECT_INSTR,
  FORMAT_INSTR,
  extractFinal,
  normalizeAnswer,
  type Problem,
} from "../lib/checker";
import { runRefinement } from "../lib/refine";
import type { Settings } from "../App";
import Markdown from "./Markdown";

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  stats?: GenStats;
  /** strategy annotation, e.g. the answer trail of a restart loop */
  meta?: string;
}

// the measured improvements, applicable per message
type ChatStrategy = "plain" | "direct" | "loop" | "loop-escalate" | "agree";

const STRATEGIES: { id: ChatStrategy; label: string; hint: string }[] = [
  { id: "plain", label: "Plain chat", hint: "normal conversation, full history" },
  { id: "direct", label: "Direct answer", hint: "terse answer, no written-out reasoning — fastest" },
  { id: "loop", label: "Restart loop", hint: "answer, then re-derive in fresh contexts until the answer converges" },
  { id: "loop-escalate", label: "Loop + reasoning revisions", hint: "direct first, free-form reasoning in revision rounds" },
  { id: "agree", label: "Agreement ×2", hint: "ask independently with varied angles until two answers match (max 3 attempts) — verified answers, 95% precision in our tests" },
];

// independent solving angles for the agreement strategy — different prompts force
// different computations at temp 0
const AGREE_ANGLES = [
  "",
  "\n\nSolve this carefully step by step, watching for traps or tricks in the wording.",
  "\n\nSolve this using a different approach than the most obvious one.",
];

export default function ChatView({ settings }: { settings: Settings }) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [strategy, setStrategy] = useState<ChatStrategy>("plain");
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<{ content: string; thinking: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, draft]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !settings.model) return;
    setError("");
    setInput("");
    const history = [...messages, { role: "user" as const, content: text }];
    setMessages(history);
    setBusy(true);
    setDraft({ content: "", thinking: "" });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      if (strategy === "agree") {
        // independent attempts (fresh context each, varied angle) until two answers
        // match — conversational attempts would echo each other (measured: 86% vs 95%)
        const attempts: { content: string; thinking: string; extracted: string }[] = [];
        let agreed = false;
        for (let i = 0; i < AGREE_ANGLES.length; i++) {
          setDraft({ content: "", thinking: "" });
          const result = await chat({
            model: settings.model,
            messages: [{ role: "user", content: text + AGREE_ANGLES[i] + FORMAT_INSTR }],
            think: settings.think,
            temperature: settings.temperature,
            numCtx: settings.numCtx,
            signal: ctrl.signal,
            onDelta: (d) =>
              setDraft((prev) => ({
                content: (prev?.content ?? "") + (d.content ?? ""),
                thinking: (prev?.thinking ?? "") + (d.thinking ?? ""),
              })),
          });
          const extracted = extractFinal(result.content);
          attempts.push({ content: result.content, thinking: result.thinking, extracted });
          const n = normalizeAnswer(extracted);
          if (n !== "" && attempts.slice(0, -1).some((a) => normalizeAnswer(a.extracted) === n)) {
            agreed = true;
            break;
          }
        }
        const final = attempts[attempts.length - 1];
        const trail = attempts.map((a) => a.extracted || "…").join("  |  ");
        setMessages((ms) => [
          ...ms,
          {
            role: "assistant",
            content: final.content,
            thinking: final.thinking || undefined,
            meta: agreed
              ? `✓ verified by agreement (${attempts.length} attempts): ${trail}`
              : `⚠ no agreement in ${attempts.length} independent attempts — low confidence: ${trail}`,
          },
        ]);
      } else if (strategy === "loop" || strategy === "loop-escalate") {
        // the message is treated as a standalone problem: each round restarts with a
        // fresh context holding only the question + the previous attempt
        const problem: Problem = {
          id: "chat",
          label: "Chat question",
          category: "chat",
          prompt: text,
          type: "word",
          expectedDisplay: "",
        };
        const records = await runRefinement(
          problem,
          {
            model: settings.model,
            maxIterations: 3,
            temperature: settings.temperature,
            think: settings.think,
            numCtx: settings.numCtx,
            stopMode: "converge",
            feedbackMode: "full-response",
            answerStyle: "direct",
            revisionStyle: strategy === "loop-escalate" ? "free" : "direct",
            revisionTemperature: settings.temperature,
          },
          (p) => {
            if (p.kind === "iteration-start") setDraft({ content: "", thinking: "" });
            else if (p.kind === "delta")
              setDraft((prev) => ({
                content: (prev?.content ?? "") + (p.delta?.content ?? ""),
                thinking: (prev?.thinking ?? "") + (p.delta?.thinking ?? ""),
              }));
          },
          ctrl.signal
        );
        const final = records[records.length - 1];
        const trail = records.map((r) => r.extracted || "…").join("  →  ");
        setMessages((ms) => [
          ...ms,
          {
            role: "assistant",
            content: final.content,
            thinking: final.thinking || undefined,
            meta: `${strategy === "loop-escalate" ? "loop+reasoning" : "restart loop"}: ${trail}${final.stoppedBecause === "converged" ? " · converged" : ""}`,
          },
        ]);
      } else {
        const apiMessages = [
          ...(systemPrompt.trim() ? [{ role: "system" as const, content: systemPrompt.trim() }] : []),
          ...history.map((m, i) => ({
            role: m.role,
            content:
              strategy === "direct" && i === history.length - 1 ? m.content + DIRECT_INSTR : m.content,
          })),
        ];
        const result = await chat({
          model: settings.model,
          messages: apiMessages,
          think: settings.think,
          temperature: settings.temperature,
          numCtx: settings.numCtx,
          signal: ctrl.signal,
          onDelta: (d) =>
            setDraft((prev) => ({
              content: (prev?.content ?? "") + (d.content ?? ""),
              thinking: (prev?.thinking ?? "") + (d.thinking ?? ""),
            })),
        });
        setMessages((ms) => [
          ...ms,
          { role: "assistant", content: result.content, thinking: result.thinking || undefined, stats: result.stats },
        ]);
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(String(e?.message ?? e));
    } finally {
      setDraft(null);
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <>
      <div className="view-header">
        <span className="view-title">Chat</span>
        <span className="view-desc">
          Free-form conversation with <b>{settings.model || "…"}</b>
          {settings.think ? " · thinking on" : " · thinking off"}
        </span>
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as ChatStrategy)}
          disabled={busy}
          title={STRATEGIES.find((s) => s.id === strategy)?.hint}
          style={{ marginLeft: "auto", maxWidth: 230 }}
        >
          {STRATEGIES.map((s) => (
            <option key={s.id} value={s.id} title={s.hint}>
              {s.label}
            </option>
          ))}
        </select>
        {messages.length > 0 && (
          <button className="btn small" onClick={() => setMessages([])} disabled={busy}>
            Clear
          </button>
        )}
      </div>

      <details className="sysprompt">
        <summary>System prompt {systemPrompt.trim() ? "· set" : "· none"}</summary>
        <textarea
          rows={2}
          placeholder="Optional system prompt…"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </details>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && !draft && (
          <div className="empty-hint">
            Ask the model anything — or try one of the trick questions from the Benchmark tab
            <br />
            and watch it stumble in real time.
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} msg={m} />
        ))}
        {draft && (
          <div className="msg assistant">
            {draft.thinking && (
              <div className="thinking-block">
                <div className="thinking-label">thinking…</div>
                {draft.thinking}
              </div>
            )}
            <div className="msg-bubble">
              {draft.content ? <Markdown>{draft.content}</Markdown> : <span className="spinner" />}
            </div>
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
      </div>

      <div className="chat-input-bar">
        <textarea
          placeholder={settings.model ? "Message the model… (Enter to send, Shift+Enter for newline)" : "Waiting for Ollama…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={!settings.model}
        />
        {busy ? (
          <button className="btn danger" onClick={stop}>
            ■ Stop
          </button>
        ) : (
          <button className="btn primary" onClick={send} disabled={!input.trim() || !settings.model}>
            Send
          </button>
        )}
      </div>
    </>
  );
}

function MessageBubble({ msg }: { msg: DisplayMessage }) {
  return (
    <div className={`msg ${msg.role}`}>
      {msg.thinking && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--purple)" }}>
            💭 thinking ({Math.round(msg.thinking.length / 4)} tokens approx.)
          </summary>
          <div className="thinking-block">{msg.thinking}</div>
        </details>
      )}
      <div className="msg-bubble">
        {msg.role === "assistant" ? <Markdown>{msg.content}</Markdown> : msg.content}
      </div>
      {msg.meta && <div className="msg-meta">{msg.meta}</div>}
      {msg.stats && (
        <div className="msg-meta">
          {(msg.stats.totalMs / 1000).toFixed(1)}s
          {msg.stats.evalCount ? ` · ${msg.stats.evalCount} tokens` : ""}
          {msg.stats.tokensPerSec ? ` · ${msg.stats.tokensPerSec.toFixed(1)} tok/s` : ""}
        </div>
      )}
    </div>
  );
}
