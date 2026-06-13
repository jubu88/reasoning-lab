# Reasoning Lab — can iteration replace chain-of-thought in small local LLMs?

An experiment (and a web workbench) testing a simple idea: small local models don't have much
context to "think" in, so instead of one long reasoning trace, **let the model answer, feed the
problem + its previous answer back in a fresh small context, and ask it to revise — repeat until
the answer stabilizes.**

Tested on **gemma4:latest (8B, Q4_K_M)** via Ollama, temperature 0, thinking mode off.

## Headline results (22-problem trick battery, exact output tokens)

| Pipeline stage | Accuracy | Output tokens |
|---|---|---|
| One-shot, direct answer | 15/22 | ~120 |
| + restart loop (fresh context, converge stop) | 17/22 | 252 |
| + fresh-CoT escalation (clean re-ask, reasoning allowed) | **21/22** | 3,428 |
| + cross-model referee (deepseek-r1 for the blind spot) | **22/22** | +~4,700 once |
| Reference: reasoning on every problem (inline CoT / thinking) | 21/22 | 5,549 / 7,276 |

Bonus rows: **direct + a 4-function toolbox = 19/22 at 574 tokens** (best accuracy-per-token
measured), and **e2b + the loop ≈ e4b one-shot at 1.9× decode speed**.

## What we learned (each claim verified causally — see EXPERIMENTS.md)

1. **The restart loop is the only free lunch.** +2 accuracy, *zero* correct answers broken in
   hundreds of revision rounds, 29× cheaper than thinking mode. Its fresh-context design is
   the mechanism: every variant that kept history failed.
2. **Visible answers anchor.** Shown any previous answer — its own or "a student's" — the
   model confirms it instead of re-deriving. Escalation must be a **clean re-ask**: fresh
   resample fixed 4/5 stuck problems; every feedback variant fixed 0/5 on misconceptions.
3. **"Are you sure?" is not a method.** Inert on the bigger model (anchor wins), harmful on
   the smaller one (sycophantic flips). Doubt without a re-derivation procedure does nothing.
4. **Temperature can't fix correctness.** Confidently-wrong answers are the mode, not noise —
   identical wrong tokens at temp 0.8, six rounds straight.
5. **Tools delete failure classes** (counting, arithmetic, string ops) — but command them
   gently: a pushy tool prompt recast trick questions as calculations and caused the loop's
   only regressions ever. Route techniques per failure class; don't stack them blindly.
6. **Greedy decoding hides uncertainty.** Monty Hall's wrong answer never moved under any
   behavioral pressure, yet sits at p≈0.53 in the logits. Answer-token logprobs caught **6/6
   wrong answers** with no answer key — the deployable escalation router.
7. **Small models shouldn't trust their own reasoning.** Free-form CoT made e2b *worse* than
   direct answering on several problems (it talks itself out of memorized correct answers).
8. **Some failures live in the weights.** gemma4 silently "repairs" the widow riddle's
   impossible premise while reading it — no prompt can arrive early enough. A different model
   family (deepseek-r1) sees through it instantly: different priors, different blind spots.
9. **Optimize tokens before silicon.** Orchestration cut latency ~14×; GPU backends gave
   1.4× on a laptop iGPU and were a net *loss* on Exynos phones
   ([EXYNOS-VULKAN.md](EXYNOS-VULKAN.md)).

Full numbers and per-problem trails: [RESULTS.md](RESULTS.md).
What each experiment does, the mechanism behind it, and **how the harness scores answers**
(batteries, checkers, determinism, caveats): [EXPERIMENTS.md](EXPERIMENTS.md).
The 36 problems with questions and answer keys: [PROBLEMS.md](PROBLEMS.md).
The app's **Results** tab shows everything interactively, organized per method, with
"re-run live" buttons that reproduce any recorded scenario against your local Ollama.

## Repo layout

```
reasoning-lab/     the web app (Vite + React) — Chat, Benchmark, Refine Lab, Results
probe.mjs          one-shot probe, classic 22-problem battery (--style free|direct)
probe2.mjs         one-shot probe, harder 14-problem battery
battery.mjs        shared problem definitions + answer checkers
gen-problems.mjs   regenerates PROBLEMS.md from battery.mjs
experiment.mjs     the refinement-loop harness (rounds, escalation, framing, scoring policies)
RESULTS.md         findings write-up
*.json             recorded probe/experiment outputs (also bundled into the app's Results tab)
```

## Running the app

```bash
ollama serve            # any recent Ollama; pull a model, e.g. gemma4
cd reasoning-lab
npm install
npm run dev             # http://localhost:5173
```

The app talks to Ollama at `localhost:11434` through the Vite dev proxy (no CORS setup).
Chat, Benchmark, and Refine Lab need a running Ollama; the **Results tab works without it** —
it renders the bundled experiment data, so the findings are browsable anywhere.
To point at an Ollama on another machine, change the proxy `target` in `reasoning-lab/vite.config.ts`.

## Reproducing the experiments

```bash
# one-shot baselines
node probe.mjs  --style free   --out probe-results.json
node probe.mjs  --style direct --out probe-direct-results.json
node probe2.mjs --style free   --out probe2-results.json

# the refinement loop (scores baseline / converged / final-round policies)
node experiment.mjs --style direct --rounds 4 --feedback full --set classic

# escalation A: temperature-jittered revisions (negative result)
node experiment.mjs --style direct --revisionTemp 0.8 --rounds 6 \
  --only count-r-strawberry,arithmetic-chain,widow-marry,count-words,monty-random-host

# escalation B: reasoning-escalated revisions (3/5 fixed)
node experiment.mjs --style direct --revisionStyle free --rounds 3 \
  --only count-r-strawberry,arithmetic-chain,widow-marry,count-words,monty-random-host

# de-anchoring: present the previous attempt as "a student's answer"
node experiment.mjs --style direct --revisionStyle free --framing student --rounds 3 \
  --only count-r-strawberry,arithmetic-chain,widow-marry,count-words,monty-random-host
```

Every run writes a JSON with full per-iteration transcripts. Answers are deterministic-ish
(fixed seeds, temp 0) but GPU nondeterminism means exact token streams may vary slightly.
