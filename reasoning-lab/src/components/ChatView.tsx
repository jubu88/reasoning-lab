import { useEffect, useRef, useState } from "react";
import { chat, type GenStats } from "../api/ollama";
import type { Settings } from "../App";

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  stats?: GenStats;
}

export default function ChatView({ settings }: { settings: Settings }) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [systemPrompt, setSystemPrompt] = useState("");
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
      const apiMessages = [
        ...(systemPrompt.trim() ? [{ role: "system" as const, content: systemPrompt.trim() }] : []),
        ...history.map((m) => ({ role: m.role, content: m.content })),
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
        {messages.length > 0 && (
          <button className="btn small" style={{ marginLeft: "auto" }} onClick={() => setMessages([])} disabled={busy}>
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
              {draft.content || <span className="spinner" />}
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
      <div className="msg-bubble">{msg.content}</div>
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
