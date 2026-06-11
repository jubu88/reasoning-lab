// Thin client for the local Ollama server, reached through the Vite proxy at /ollama.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelInfo {
  name: string;
  parameterSize?: string;
  quantization?: string;
  remote?: boolean;
}

export interface GenStats {
  totalMs: number;
  evalCount?: number;
  promptEvalCount?: number;
  tokensPerSec?: number;
}

export interface ChatResult {
  content: string;
  thinking: string;
  stats: GenStats;
}

export interface ChatParams {
  model: string;
  messages: ChatMessage[];
  think: boolean;
  temperature: number;
  numCtx?: number;
  seed?: number;
  /** generation cap; bounds runaway responses so benchmark timing stays comparable */
  numPredict?: number;
  signal?: AbortSignal;
  onDelta?: (delta: { content?: string; thinking?: string }) => void;
}

export async function listModels(): Promise<ModelInfo[]> {
  const res = await fetch("/ollama/api/tags");
  if (!res.ok) throw new Error(`Failed to list models (HTTP ${res.status})`);
  const data = await res.json();
  return (data.models ?? []).map((m: any) => ({
    name: m.name,
    parameterSize: m.details?.parameter_size,
    quantization: m.details?.quantization_level,
    remote: Boolean(m.remote_model),
  }));
}

export async function checkConnection(): Promise<boolean> {
  try {
    const res = await fetch("/ollama/api/version");
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Streaming chat. Accumulates content/thinking and reports deltas via onDelta.
 * If the server rejects the `think` parameter (models without optional thinking),
 * the request is retried once without it.
 */
export async function chat(params: ChatParams): Promise<ChatResult> {
  const { model, messages, think, temperature, numCtx, seed, numPredict, signal, onDelta } = params;

  const makeBody = (includeThink: boolean) =>
    JSON.stringify({
      model,
      messages,
      stream: true,
      ...(includeThink ? { think } : {}),
      keep_alive: "15m",
      options: {
        temperature,
        num_predict: numPredict ?? 2048,
        ...(numCtx ? { num_ctx: numCtx } : {}),
        ...(seed !== undefined ? { seed } : {}),
      },
    });

  const t0 = performance.now();
  let res = await fetch("/ollama/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: makeBody(true),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    // Models without optional thinking reject the `think` parameter with a 400.
    if (res.status === 400 && /think/i.test(errText)) {
      res = await fetch("/ollama/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: makeBody(false),
        signal,
      });
      if (!res.ok) {
        const retryErr = await res.text().catch(() => "");
        throw new Error(`Ollama error (HTTP ${res.status}): ${retryErr.slice(0, 300)}`);
      }
    } else {
      throw new Error(`Ollama error (HTTP ${res.status}): ${errText.slice(0, 300)}`);
    }
  }
  if (!res.body) throw new Error("No response body from Ollama");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let thinking = "";
  let evalCount: number | undefined;
  let promptEvalCount: number | undefined;

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let chunk: any;
    try {
      chunk = JSON.parse(trimmed);
    } catch {
      console.warn("ollama stream: skipping malformed line:", trimmed.slice(0, 120));
      return;
    }
    if (chunk.error) throw new Error(`Ollama: ${chunk.error}`);
    const dContent: string = chunk.message?.content ?? "";
    const dThinking: string = chunk.message?.thinking ?? "";
    if (dContent) content += dContent;
    if (dThinking) thinking += dThinking;
    if ((dContent || dThinking) && !signal?.aborted) {
      onDelta?.({ content: dContent, thinking: dThinking });
    }
    if (chunk.done) {
      evalCount = chunk.eval_count;
      promptEvalCount = chunk.prompt_eval_count;
    }
  };

  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  }
  if (buffer.trim()) processLine(buffer);

  const totalMs = performance.now() - t0;
  return {
    content,
    thinking,
    stats: {
      totalMs,
      evalCount,
      promptEvalCount,
      tokensPerSec: evalCount ? evalCount / (totalMs / 1000) : undefined,
    },
  };
}
