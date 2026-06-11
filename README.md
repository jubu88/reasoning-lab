# Reasoning Lab — can iteration replace chain-of-thought in small local LLMs?

An experiment (and a web workbench) testing a simple idea: small local models don't have much
context to "think" in, so instead of one long reasoning trace, **let the model answer, feed the
problem + its previous answer back in a fresh small context, and ask it to revise — repeat until
the answer stabilizes.**

Tested on **gemma4:latest (8B, Q4_K_M)** via Ollama, temperature 0, thinking mode off.

## Headline results (22-problem trick battery, direct answers — no visible reasoning)

| Pipeline stage | Accuracy | Cost per problem |
|---|---|---|
| One-shot, direct answer | 15/22 | ~5 s |
| + refinement loop (4 rounds, honest convergence stop) | 17/22 | ~15–40 s |
| + free-form reasoning in revision rounds only | **20/22** | reasoning spent only on flagged problems |
| Reference: free-form reasoning every time | 21/22 | 10–160 s |

Three findings worth knowing:

1. **The loop is safe.** Across 60 opportunities to second-guess a correct answer, iteration
   never flipped one to wrong.
2. **Sampling jitter does nothing.** At revision temperature 0.8 the model reproduced the
   *identical* wrong answer six rounds straight on every stuck problem. Confidently-wrong
   answers are the model's strong mode, not noise — but letting it *reason* during revisions
   fixes most of them in a single round.
3. **Feedback anchors misconceptions.** The model solves the widow riddle and the random-host
   Monty Hall one-shot when reasoning freely — but shown its own wrong answer, it talks itself
   into confirming it. Re-feeding answers helps the model catch slips and *entrenches* its
   misconceptions.

Full write-up with per-problem trails: [RESULTS.md](RESULTS.md).

## Repo layout

```
reasoning-lab/     the web app (Vite + React) — Chat, Benchmark, Refine Lab, Results
probe.mjs          one-shot probe, classic 22-problem battery (--style free|direct)
probe2.mjs         one-shot probe, harder 14-problem battery
battery.mjs        shared problem definitions + answer checkers
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
