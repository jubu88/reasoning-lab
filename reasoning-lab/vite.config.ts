import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /ollama/* to the local Ollama server so the browser never deals with CORS.
export default defineConfig({
  plugins: [react()],
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
