# Reasoning Lab

A local workbench for chatting with Ollama models and experimenting with **iterative self-refinement** as an alternative to long chain-of-thought.

## The idea

Small local models don't have a lot of context to "think" in. Instead of one long reasoning trace, the loop here works like this:

1. The model answers the problem (attempt 0, the **baseline**).
2. Each following round, the model gets a **fresh, small context** containing only the problem and its previous attempt, and is asked to re-examine and revise.
3. The loop stops after a fixed number of rounds, when the answer converges (repeats), or — for demos only — when an answer key says it's correct.

## Running

```
ollama serve          # if not already running
npm install
npm run dev           # opens on http://localhost:5173
```

The app talks to Ollama at `localhost:11434` through the Vite dev proxy, so no CORS setup is needed.

## Views

- **Chat** — streaming conversation, optional system prompt, thinking-mode toggle, per-message latency/token stats.
- **Benchmark** — one-shot accuracy on a suite of trick/reasoning problems with automatic answer checking.
- **Refine Lab** — run the refinement loop on any suite problem or your own custom problem; every iteration is shown with its prompt, response, extracted answer, and verdict.
- **Code Lab** — a local model builds a static web app agentically via tool-calling (write/read/list files, web search/fetch, optional image generation). Each build is jailed to its own `code-lab/workspace/projects/<id>/` folder (no overwriting), rendered in a sandboxed iframe, and exportable as a zip. Console errors from the preview can be fed back to the model to fix.

## Optional: local image generation (Code Lab)

Code Lab can let the model generate real images via [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp). It's optional — without it, `generate_image` simply reports "unavailable" and the rest works. To enable:

1. Download a stable-diffusion.cpp release binary (the **Vulkan** build is ~4× faster than CPU on an Intel iGPU) and an SD 1.5 model (`.safetensors`).
2. Place them at `sd/vulkan/sd-cli.exe` and `sd/sd-v1-5.safetensors` (repo root), or point `SD_CLI` / `SD_MODEL` env vars at your own paths.

Generation is local and CPU/iGPU-bound — roughly 30–60 s per image on an Iris Xe via Vulkan.

## Settings that matter

- **Thinking mode** — the model's built-in chain-of-thought (gemma4 supports toggling it).
- **Direct answers** — forbids written-out reasoning in Benchmark/Refine prompts. This is the interesting baseline: with reasoning suppressed, one-shot accuracy drops sharply, and the question becomes whether *iteration alone* can recover it.
- **Stopping rule** — `converge` and `fixed` are honest (no ground truth used); `oracle` peeks at the answer key and is for demos only.
- **Feedback mode** — show the model its full previous response, or only its previous final answer (forces a fresh derivation).
- **Escalation (Refine Lab)** — keep the baseline direct but allow free-form reasoning in revision rounds, and/or raise the revision temperature to break confidently-wrong lock-in. Instant convergence on a wrong answer is the signal that escalation is needed.

## Related scripts (parent folder)

- `probe.mjs` / `probe2.mjs` — find problems the model fails one-shot.
- `experiment.mjs` — headless baseline-vs-refined accuracy over a whole battery, scoring baseline / converged / final-round policies.
