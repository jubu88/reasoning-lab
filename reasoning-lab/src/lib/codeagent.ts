// Code Lab agent engine: an Ollama tool-calling loop that lets a local model build
// a static webapp in the jailed workspace. The model emits tool calls; we execute
// them against the /codelab backend and feed results back until it calls `done`
// or hits the iteration cap.

const OLLAMA = "/ollama";
const API = "/codelab/api";

// Curated, coherent design systems. Small models style ad-hoc (clashing colors,
// random spacing, emoji icons); handing them a ready-to-paste token set fixes the
// single biggest "looks amateur" tell. Each returns a complete, drop-in :root block.
const DESIGN_SYSTEMS: Record<string, string> = {
  "modern-saas": `Style: Modern SaaS — clean, trustworthy, indigo accent.
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
:root{
  --bg:#f8fafc; --surface:#ffffff; --text:#0f172a; --muted:#64748b; --border:#e2e8f0;
  --primary:#4f46e5; --primary-fg:#ffffff; --accent:#06b6d4;
  --font:'Inter',system-ui,sans-serif; --display:'Inter',sans-serif;
  --radius:10px; --shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(15,23,42,.06);
  --space:8px;
}
Use: body background var(--bg), cards var(--surface)+var(--border)+var(--radius)+var(--shadow), buttons var(--primary)/var(--primary-fg), headings var(--display) weight 700.`,

  "warm-artisan": `Style: Warm Artisan — cozy, handcrafted, cream + terracotta, serif headings.
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Lato:wght@400;700&display=swap" rel="stylesheet">
:root{
  --bg:#f5f0e8; --surface:#fffdf9; --text:#3a2e25; --muted:#8a7a6a; --border:#e6dccd;
  --primary:#b25d33; --primary-fg:#fffdf9; --accent:#6f7d4e;
  --font:'Lato',system-ui,sans-serif; --display:'Playfair Display',serif;
  --radius:8px; --shadow:0 2px 10px rgba(58,46,37,.08);
  --space:8px;
}
Use: serif var(--display) for headings, var(--primary) terracotta for CTAs, generous padding, soft shadows.`,

  "playful": `Style: Playful — bright, rounded, energetic.
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;700;800&display=swap" rel="stylesheet">
:root{
  --bg:#fff7ed; --surface:#ffffff; --text:#1f2937; --muted:#6b7280; --border:#fde68a;
  --primary:#f97316; --primary-fg:#ffffff; --accent:#8b5cf6;
  --font:'Poppins',system-ui,sans-serif; --display:'Poppins',sans-serif;
  --radius:20px; --shadow:0 10px 30px rgba(249,115,22,.18);
  --space:10px;
}
Use: big radii, bold weights (800 headings), vivid var(--primary)/var(--accent), chunky buttons.`,

  "minimal-mono": `Style: Minimal Monochrome — black/white, lots of whitespace, sharp.
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet">
:root{
  --bg:#ffffff; --surface:#ffffff; --text:#111111; --muted:#777777; --border:#111111;
  --primary:#111111; --primary-fg:#ffffff; --accent:#111111;
  --font:'Space Grotesk',system-ui,sans-serif; --display:'Space Grotesk',sans-serif;
  --radius:0px; --shadow:none;
  --space:12px;
}
Use: hairline 1px var(--border) borders, no shadows, square corners, huge whitespace, black buttons.`,

  "dark-dashboard": `Style: Dark Dashboard — deep surfaces, neon accent.
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
:root{
  --bg:#0b0f1a; --surface:#141a29; --text:#e5e9f0; --muted:#8b95a7; --border:#232a3b;
  --primary:#3b82f6; --primary-fg:#ffffff; --accent:#22d3ee;
  --font:'Inter',system-ui,sans-serif; --display:'Inter',sans-serif;
  --radius:12px; --shadow:0 8px 30px rgba(0,0,0,.4);
  --space:8px;
}
Use: dark var(--bg), elevated var(--surface) cards, var(--accent) cyan highlights, glowing primary buttons.`,
};

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
  /** true if the generation hit the token cap (likely a truncated/garbled write) */
  truncated?: boolean;
}

export interface AgentProgress {
  iteration: number;
  /** live-streamed assistant text so far this turn */
  text: string;
  /** approximate tokens generated this turn (one stream chunk ≈ one token) */
  tokens: number;
}

export interface AgentConfig {
  model: string;
  task: string;
  project: string;
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
      name: "get_design_system",
      description:
        "Get a coherent, ready-to-use design system (color palette, fonts, spacing, radius, shadows) for a named visual style. CALL THIS FIRST, before writing any CSS, then style everything with the returned CSS variables for a professional, consistent look. Styles: modern-saas, warm-artisan, playful, minimal-mono, dark-dashboard.",
      parameters: {
        type: "object",
        properties: { style: { type: "string", description: "one of: modern-saas, warm-artisan, playful, minimal-mono, dark-dashboard" } },
        required: ["style"],
      },
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
      name: "generate_image",
      description:
        "Generate a photographic image with local Stable Diffusion and save it into the project as a PNG. Use for photos/hero images that real content needs (e.g. furniture, food, people). Reference the saved path in your HTML, e.g. <img src=\"hero.png\">. Slow (~1 minute each) — use sparingly, and prefer CSS/SVG for icons and decorative graphics.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "output filename, e.g. hero.png" },
          prompt: { type: "string", description: "detailed image description" },
          width: { type: "number", description: "64-512, default 384" },
          height: { type: "number", description: "64-512, default 384" },
        },
        required: ["path", "prompt"],
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
- FIRST call get_design_system with a style that fits the request, paste its CSS variables into your stylesheet, and style EVERYTHING with those variables (colors, font, radius, shadow, spacing). This is how you get a professional, consistent look — do not invent your own ad-hoc colors.
- Write complete, working files with write_file. No placeholders or "TODO" — write the real code.
- Everything runs in a sandboxed iframe with no network except CDNs you include. No backend, no localStorage guarantees.
- Keep it to a few files (index.html, optionally style.css and app.js, or inline).
- For photos the design needs (hero shots, product images), call generate_image to create a real PNG and reference it with <img src="..."> — do NOT invent filenames for images that don't exist. Use CSS gradients or inline SVG for icons, patterns, and decoration. Generating images is slow, so generate only the few that matter.
- When the app is finished and index.html exists, call done with a short summary.
- Do not explain at length between tool calls; act.`;

async function callTool(name: string, args: any, project: string): Promise<string> {
  try {
    if (name === "get_design_system") {
      const key = String(args.style || "").toLowerCase();
      return DESIGN_SYSTEMS[key] ?? `Unknown style "${args.style}". Available: ${Object.keys(DESIGN_SYSTEMS).join(", ")}. ${DESIGN_SYSTEMS["modern-saas"]}`;
    }
    if (name === "list_files") {
      const r = await (await fetch(`${API}/list?project=${encodeURIComponent(project)}`)).json();
      return JSON.stringify(r.files ?? []);
    }
    if (name === "write_file") {
      const r = await (await fetch(`${API}/write`, post({ project, path: args.path, content: args.content }))).json();
      return r.ok ? `wrote ${r.path} (${r.bytes} bytes)` : `error: ${r.error}`;
    }
    if (name === "read_file") {
      const r = await (await fetch(`${API}/read`, post({ project, path: args.path }))).json();
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
    if (name === "generate_image") {
      const r = await (
        await fetch(`${API}/generate-image`, post({ project, path: args.path, prompt: args.prompt, width: args.width, height: args.height }))
      ).json();
      return r.ok ? `generated ${r.path} (${r.width}x${r.height}, ${r.seconds}s) — reference it with <img src="${r.path}">` : `error: ${r.error}`;
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

export async function createProject(name: string): Promise<string> {
  const r = await (await fetch(`${API}/project/new`, post({ name }))).json();
  if (!r.ok) throw new Error(r.error || "could not create project");
  return r.id as string;
}

export interface ProjectInfo {
  id: string;
  files: number;
  hasIndex: boolean;
  mtime: number;
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const r = await (await fetch(`${API}/projects`)).json();
  return r.projects ?? [];
}

export async function runAgent(
  config: AgentConfig,
  onStep: (step: AgentStep) => void,
  onProgress?: (p: AgentProgress) => void,
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
    // stream so a long generation shows live progress instead of looking frozen
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages,
        tools: TOOLS,
        stream: true,
        think: false,
        keep_alive: "15m",
        // generous cap: a full inline page can exceed 4096 tokens and truncating
        // mid-tool-call corrupts the write. 8192 fits within the 16384 num_ctx below.
        options: { temperature: config.temperature, num_ctx: 16384, num_predict: 8192 },
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    if (!res.body) throw new Error("no response body from Ollama");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let content = "";
    let thinking = "";
    const rawToolCalls: any[] = [];
    let evalCount: number | undefined;
    let doneReason: string | undefined;
    let liveTokens = 0;

    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let chunk: any;
        try {
          chunk = JSON.parse(line);
        } catch {
          continue;
        }
        if (chunk.error) throw new Error(`Ollama: ${chunk.error}`);
        const m = chunk.message ?? {};
        if (m.content) content += m.content;
        if (m.thinking) thinking += m.thinking;
        if (m.tool_calls?.length) rawToolCalls.push(...m.tool_calls);
        if (chunk.done) {
          evalCount = chunk.eval_count ?? evalCount;
          doneReason = chunk.done_reason ?? doneReason;
        } else {
          // Ollama buffers tool-call generation: intermediate chunks carry empty
          // content, but each chunk IS one generation step — count them all so the
          // UI shows live progress instead of looking frozen.
          liveTokens++;
          const names = m.tool_calls?.length ? ` · writing ${m.tool_calls.map((t: any) => t.function?.name).join(", ")}` : "";
          onProgress?.({ iteration: i, text: (content || "thinking / building…") + names, tokens: liveTokens });
        }
      }
    }

    const assistantMsg: any = { role: "assistant", content };
    if (thinking) assistantMsg.thinking = thinking;
    if (rawToolCalls.length) assistantMsg.tool_calls = rawToolCalls;
    messages.push(assistantMsg);

    const toolCalls: ToolCallRecord[] = [];
    for (const tc of rawToolCalls) {
      const name = tc.function?.name;
      const args = typeof tc.function?.arguments === "string" ? safeParse(tc.function.arguments) : tc.function?.arguments ?? {};
      const result = await callTool(name, args, config.project);
      toolCalls.push({ name, args, result });
      messages.push({ role: "tool", tool_name: name, content: result.slice(0, 4000) });
    }

    const isDone = toolCalls.some((t) => t.name === "done");
    onStep({
      iteration: i,
      thinking: thinking || undefined,
      message: content,
      toolCalls,
      done: isDone,
      tokens: evalCount ?? liveTokens,
      truncated: doneReason === "length",
    });

    if (isDone) return;
    // a turn with no tool calls and no done — nudge once, then stop if it persists
    if (!rawToolCalls.length) {
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
