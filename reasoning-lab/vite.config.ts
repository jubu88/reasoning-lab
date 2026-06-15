import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { codeLabPlugin } from "./code-lab/server.mjs";

// Proxy /ollama/* to the local Ollama server so the browser never deals with CORS.
// codeLabPlugin adds the sandboxed Code Lab backend under /codelab/* (file tools,
// web fetch/search, static preview) — all jailed to code-lab/workspace.
export default defineConfig({
  plugins: [react(), codeLabPlugin()],
  server: {
    port: 5173,
    proxy: {
      "/ollama": {
        target: "http://localhost:11434",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ollama/, ""),
      },
    },
  },
});
