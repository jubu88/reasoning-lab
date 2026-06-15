// Code Lab agent engine: an Ollama tool-calling loop that lets a local model build
// a static webapp in the jailed workspace. The model emits tool calls; we execute
// them against the /codelab backend and feed results back until it calls `done`
// or hits the iteration cap.

const OLLAMA = "/ollama";
const API = "/codelab/api";

export interface ToolCallRecord {
  name: string;
  args: any;
  result: string;
}

export interface AgentStep {
  iteration: number;
  thinking?: string;
  message: string;
  toolCalls: ToolCallRecord[];
  done: boolean;
  tokens?: number;
}

export interface AgentConfig {
  model: string;
  task: string;
  maxIterations: number;
  temperature: number;
  /** runtime errors captured from the preview iframe, fed in to seed a fix */
  consoleErrors?: string[];
}

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or overwrite a file in the project. Use relative paths like index.html, style.css, app.js. Allowed types: html, css, js, json, svg, txt, md.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "relative file path, e.g. index.html" },
          content: { type: "string", description: "the full file contents" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read back a file you have written, to inspect or revise it.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List the files currently in the project.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for documentation or examples. Returns titles and URLs.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch a web page by URL and return its text content.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "done",
      description:
        "Call this when the app is complete and index.html is written. Provide a one-line summary of what you built.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
    },
  },
];

const SYSTEM = `You are a coding agent that builds small STATIC web apps (HTML + CSS + vanilla JS, or libraries loaded from a CDN). You work by calling tools.

Rules:
- The app MUST have an entry file named exactly "index.html".
- Write complete, working files with write_file. No placeholders or "TODO" — write the real code.
- Everything runs in a sandboxed iframe with no network except CDNs you include. No backend, no localStorage guarantees.
- Keep it to a few files (index.html, optionally style.css and app.js, or inline).
- When the app is finished and index.html exists, call done with a short summary.
- Do not explain at length between tool calls; act.`;

async function callTool(name: string, args: any): Promise<string> {
  try {
    if (name === "list_files") {
      const r = await (await fetch(`${API}/list`)).json();
      return JSON.stringify(r.files ?? []);
    }
    if (name === "write_file") {
      const r = await (await fetch(`${API}/write`, post({ path: args.path, content: args.content }))).json();
      return r.ok ? `wrote ${r.path} (${r.bytes} bytes)` : `error: ${r.error}`;
    }
    if (name === "read_file") {
      const r = await (await fetch(`${API}/read`, post({ path: args.path }))).json();
      return r.ok ? r.content : `error: ${r.error}`;
    }
    if (name === "web_search") {
      const r = await (await fetch(`${API}/web-search`, post({ query: args.query }))).json();
      return r.ok ? JSON.stringify(r.results) : `error: ${r.error}`;
    }
    if (name === "web_fetch") {
      const r = await (await fetch(`${API}/web-fetch`, post({ url: args.url }))).json();
      return r.ok ? `[${r.status}] ${r.text}` : `error: ${r.error}`;
    }
    if (name === "done") return "done";
    return `error: unknown tool ${name}`;
  } catch (e: any) {
    return `error: ${String(e?.message ?? e)}`;
  }
}

function post(body: any): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export async function resetWorkspace() {
  await fetch(`${API}/reset`, { method: "POST" });
}

export async function runAgent(
  config: AgentConfig,
  onStep: (step: AgentStep) => void,
  signal?: AbortSignal
): Promise<void> {
  const messages: any[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content:
        `Build this app:\n\n${config.task}\n\n` +
        (config.consoleErrors?.length
          ? `The current version produced these runtime errors in the browser — fix them:\n${config.consoleErrors.join("\n")}\n\n`
          : "") +
        `Start now. Remember: the entry file must be index.html, and call done when finished.`,
    },
  ];

  for (let i = 0; i < config.maxIterations; i++) {
    if (signal?.aborted) return;
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages,
        tools: TOOLS,
        stream: false,
        think: false,
        keep_alive: "15m",
        options: { temperature: config.temperature, num_ctx: 8192, num_predict: 4096 },
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const msg = data.message ?? {};
    const toolCalls: ToolCallRecord[] = [];

    messages.push(msg);

    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        const name = tc.function?.name;
        const args = typeof tc.function?.arguments === "string" ? safeParse(tc.function.arguments) : tc.function?.arguments ?? {};
        const result = await callTool(name, args);
        toolCalls.push({ name, args, result });
        messages.push({ role: "tool", tool_name: name, content: result.slice(0, 4000) });
      }
    }

    const isDone = toolCalls.some((t) => t.name === "done");
    onStep({
      iteration: i,
      thinking: msg.thinking || undefined,
      message: msg.content ?? "",
      toolCalls,
      done: isDone,
      tokens: data.eval_count,
    });

    if (isDone) return;
    // a turn with no tool calls and no done — nudge once, then stop if it persists
    if (!msg.tool_calls?.length) {
      messages.push({ role: "user", content: "Continue building with tool calls, or call done if index.html is complete." });
    }
  }
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
