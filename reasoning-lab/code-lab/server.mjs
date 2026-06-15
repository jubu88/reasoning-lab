// Code Lab backend, implemented as Vite dev-server middleware (runs in the dev
// process — no second port). It is the TRUST BOUNDARY for the local model: the
// model only emits tool calls; this code executes them under strict rules.
//
// Everything is confined to ./workspace. Path-escape, SSRF, size and extension
// limits are enforced here, never by trusting the model.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "workspace");

const MAX_FILE_BYTES = 512 * 1024; // 512 KB per file
const MAX_FILES = 60;
const MAX_FETCH_BYTES = 200 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
// only web-app source files — we never execute anything, but keep it tidy/safe
const ALLOWED_EXT = new Set([
  ".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".md", ".csv",
]);

function ensureRoot() {
  fs.mkdirSync(ROOT, { recursive: true });
}

// resolve a model-supplied relative path and guarantee it stays inside ROOT
function safePath(rel) {
  if (typeof rel !== "string" || rel.includes("\0")) throw new Error("invalid path");
  const cleaned = rel.replace(/^[/\\]+/, ""); // strip leading slashes so it can't be absolute
  const p = path.resolve(ROOT, cleaned);
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) throw new Error("path escapes workspace");
  return p;
}

function checkExt(p) {
  const ext = path.extname(p).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error(`extension not allowed: ${ext || "(none)"}`);
}

function listFiles() {
  ensureRoot();
  const out = [];
  const walk = (dir, prefix) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, rel);
      else out.push({ path: rel, bytes: st.size });
    }
  };
  walk(ROOT, "");
  return out;
}

function resetWorkspace() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  ensureRoot();
}

// block obvious SSRF targets (localhost, link-local, private ranges)
function ssrfBlocked(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return "invalid url";
  }
  if (!/^https?:$/.test(u.protocol)) return "only http(s) allowed";
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h.endsWith(".local") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  )
    return "blocked host (private/loopback)";
  return null;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function webFetch(url) {
  const blocked = ssrfBlocked(url);
  if (blocked) throw new Error(blocked);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "ReasoningLab-CodeLab/0.1" } });
    const ct = res.headers.get("content-type") ?? "";
    const raw = (await res.text()).slice(0, MAX_FETCH_BYTES * 4);
    const text = /html/i.test(ct) ? htmlToText(raw) : raw;
    return { status: res.status, contentType: ct, text: text.slice(0, MAX_FETCH_BYTES) };
  } finally {
    clearTimeout(timer);
  }
}

async function webSearch(query) {
  // DuckDuckGo HTML endpoint — no API key. Best-effort scrape.
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; ReasoningLab/0.1)" } });
    const html = await res.text();
    const results = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && results.length < 6) {
      let link = m[1];
      const dd = link.match(/uddg=([^&]+)/);
      if (dd) link = decodeURIComponent(dd[1]);
      results.push({ title: htmlToText(m[2]), url: link });
    }
    return { results };
  } finally {
    clearTimeout(timer);
  }
}

// Injected into served HTML so the sandboxed preview can report runtime errors and
// console output to the parent via postMessage — works WITHOUT allow-same-origin,
// so the iframe stays fully isolated. This is what powers the "fix your errors" loop.
const REPORTER = `<script>(function(){function s(t,a){try{parent.postMessage({__codelab:true,type:t,text:Array.prototype.map.call(a,function(x){try{return typeof x==='object'?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(' ')},'*')}catch(e){}}
window.addEventListener('error',function(e){s('error',[(e.message||'error')+' @ '+(e.filename||'')+':'+(e.lineno||0)])});
window.addEventListener('unhandledrejection',function(e){s('error',['unhandledrejection: '+((e.reason&&e.reason.message)||e.reason)])});
['log','warn','error'].forEach(function(k){var o=console[k];console[k]=function(){s(k,arguments);o.apply(console,arguments)}});})();</script>`;

function injectReporter(html) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + REPORTER);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + REPORTER);
  return REPORTER + html;
}

const MIME = {
  ".html": "text/html", ".htm": "text/html", ".css": "text/css",
  ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".txt": "text/plain", ".md": "text/plain", ".csv": "text/csv",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 2 * 1024 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(body);
}

export function codeLabPlugin() {
  return {
    name: "code-lab-backend",
    configureServer(server) {
      ensureRoot();
      server.middlewares.use(async (req, res, next) => {
        const u = req.url || "";
        if (!u.startsWith("/codelab/")) return next();

        try {
          // ---- preview: serve workspace files in a sandboxed iframe ----
          if (u.startsWith("/codelab/preview")) {
            let rel = decodeURIComponent(u.slice("/codelab/preview".length).split("?")[0]);
            if (rel === "" || rel === "/") rel = "/index.html";
            const p = safePath(rel);
            if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
              res.statusCode = 404;
              res.end("not found in workspace");
              return;
            }
            const ext = path.extname(p).toLowerCase();
            res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
            res.setHeader("Cache-Control", "no-store");
            if (ext === ".html" || ext === ".htm") {
              res.end(injectReporter(fs.readFileSync(p, "utf8")));
            } else {
              fs.createReadStream(p).pipe(res);
            }
            return;
          }

          // ---- tool API ----
          if (u === "/codelab/api/list" && req.method === "GET") {
            return sendJson(res, 200, { files: listFiles() });
          }
          if (u === "/codelab/api/reset" && req.method === "POST") {
            resetWorkspace();
            return sendJson(res, 200, { ok: true });
          }
          if (u === "/codelab/api/read" && req.method === "POST") {
            const { path: rel } = await readBody(req);
            const p = safePath(rel);
            if (!fs.existsSync(p)) return sendJson(res, 200, { ok: false, error: "file does not exist" });
            return sendJson(res, 200, { ok: true, content: fs.readFileSync(p, "utf8") });
          }
          if (u === "/codelab/api/write" && req.method === "POST") {
            const { path: rel, content } = await readBody(req);
            const p = safePath(rel);
            checkExt(p);
            if (typeof content !== "string") throw new Error("content must be a string");
            if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error("file too large");
            if (listFiles().length >= MAX_FILES && !fs.existsSync(p)) throw new Error("too many files");
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, content, "utf8");
            return sendJson(res, 200, { ok: true, path: rel, bytes: Buffer.byteLength(content, "utf8") });
          }
          if (u === "/codelab/api/web-fetch" && req.method === "POST") {
            const { url } = await readBody(req);
            const r = await webFetch(url);
            return sendJson(res, 200, { ok: true, ...r });
          }
          if (u === "/codelab/api/web-search" && req.method === "POST") {
            const { query } = await readBody(req);
            const r = await webSearch(query);
            return sendJson(res, 200, { ok: true, ...r });
          }

          res.statusCode = 404;
          return sendJson(res, 404, { ok: false, error: "unknown codelab route" });
        } catch (e) {
          return sendJson(res, 200, { ok: false, error: String(e?.message ?? e) });
        }
      });
    },
  };
}
