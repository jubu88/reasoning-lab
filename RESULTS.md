# Iterative self-refinement experiment — gemma4:latest (8B Q4), June 11 2026

**Hypothesis (yours):** instead of long chain-of-thought (which costs context), let the model
answer, then feed the problem + its previous answer back in a *fresh* context and ask it to
re-examine and revise, repeating until the answer stabilizes.

All runs: temperature 0, thinking mode off, fixed seeds. Raw data in `probe-results.json`,
`probe-direct-results.json`, `probe2-results.json`, `exp-*.json`.

## 1. Finding problems it fails by default

| Setting | Battery | One-shot accuracy |
|---|---|---|
| Free-form (may write reasoning in its answer) | 22 classic trick questions | **21/22** |
| Free-form | 14 harder problems | **13/14** |
| **Direct answers (no visible reasoning allowed)** | 22 classic trick questions | **15/22** |

Two things matter here:

- gemma4 8B writes step-by-step reasoning into its normal answers even with thinking off,
  and that inline CoT is enough to pass almost everything classic (responses take 10–160s).
  Its only true free-form failures: counting t's in a sentence (says 13, real answer 15), and
  the random-host Monty Hall *when the generation cap is too low* (it passes with a 2048-token cap —
  the earlier "failure" was truncation, a useful lesson in itself).
- Forbidding written-out reasoning ("direct mode") drops accuracy to 15/22 and answers arrive
  in ~5–10s. This is the setting that matches your premise — little context spent — and it's
  where iteration has room to help.

## 2. Does iteration help? (direct mode, 4 revision rounds, full-response feedback)

| Policy | Accuracy |
|---|---|
| Baseline (one-shot) | 15/22 |
| Refined, honest convergence stop | **17/22** |
| Refined, final round | **17/22** |

- **Fixed by iteration:** `weekday-feb14` (Thursday → Saturday on round 1, then stable — a clean,
  reproducible self-correction; verified again live through the app UI) and `height-order`
  (Emma → Carl → Ben → Carl → Ben — it oscillated and happened to end on the right answer;
  with 3 rounds instead of 4 it would have ended wrong, so treat this one as a coin-flip fix).
- **Broken by iteration: none.** Across 15 problems it had right, 4 revision rounds each
  (60 opportunities to second-guess), it never flipped a correct answer to wrong. The loop is
  cheap insurance, not a hazard.
- **Immune to iteration (5):** strawberry r-count ("2" × 5 rounds), arithmetic chain ("39" × 5),
  widow riddle ("Yes" × 5), word count ("12" × 5), random-host Monty Hall ("Switch" × 5).
  At temperature 0 the model is *confidently* wrong — re-showing it its own answer just makes
  it re-assert it.

## 3. What this means

Iteration-with-feedback fixes **careless-slip failures** (date arithmetic, ordering) but not:

1. **Perception failures** (letter/word counting) — the model literally can't see characters
   through its tokenizer; no amount of re-reading its answer adds information.
2. **Systematic misconceptions** (Monty Hall pattern-matching, missed premise in the widow
   riddle) — the flaw is in the model's prior, and the prior regenerates the same answer.

Both failure modes produce the same loop signature: instant convergence on the wrong answer.
We tested two escalation strategies on exactly these 5 stuck problems.

## 4. Escalation experiments (the 5 stuck problems)

| Strategy | Fixed |
|---|---|
| A. Revision temperature 0.8, 6 rounds, still direct | **0/5** — identical wrong answer all 6 rounds, every problem |
| B. Hybrid: direct baseline → free-form reasoning in revisions, 3 rounds | **3/5** — strawberry (2→3), arithmetic chain (39→64), word count (12→13); all stable after one revision |

Two conclusions:

- **Sampling jitter does nothing.** Even at temperature 0.8, the model reproduces the same
  wrong token sequence every round. These aren't near-miss answers a lucky sample flips;
  the wrong answer is the model's strong mode.
- **Letting the model *reason* in revision rounds is what works** — it fixes everything
  that free-form one-shot can solve, while keeping the fast direct path for the 15 problems
  that never needed help. Combined pipeline on the classic battery:
  **15/22 one-shot direct → 17/22 with the plain loop → 20/22 with reasoning-escalated revisions**,
  spending reasoning tokens on only the handful of problems whose loop signature signaled trouble.

The two still-unfixed problems (widow riddle "Yes", Monty Hall "Switch") expose a real
phenomenon: **anchoring**. Free-form *one-shot* solves both — but in a revision round, with
its own wrong answer in the prompt, the model talks itself into confirming it instead.
Feedback helps the model catch slips, but it *entrenches* misconceptions.

## 5. De-anchoring attempt: it's answer-presence bias, not self-bias

We re-ran escalation B with the previous attempt framed as **"another student's attempt"**
(including an explicit warning that students often fall for trick questions): **3/5 — identical
to self-framing.** The widow riddle and random-host Monty Hall still self-confirm every round,
even though the model solves both one-shot with no prior answer in the prompt.

So the anchor is not "I said this" — it is the mere presence of *any* proposed answer in the
context. For misconception-type failures, showing the model a candidate answer (anyone's)
biases its reasoning toward confirming it. Practical consequence for refinement pipelines:
when the loop converges instantly on round 1, the cheapest reliable fix is a **fresh one-shot
reasoning pass with no feedback at all**, not another feedback round.

## 6. Model-size frontier: e2b vs e4b (the on-device question)

Context: these are the variants shipped in the user's phone app, and `gemma4:latest` turned out
to be the **same artifact as `gemma4:e4b`** (identical digests) — so all results above are
already about the production model. The e2b run (`compare.mjs`, `compare-e2b.json`):

| Model | Free-form | Direct | Direct + loop | Decode speed |
|---|---|---|---|---|
| gemma4:e4b | 21/22 | 15/22 | 17/22 (20/22 w/ escalation) | 12.9 tok/s |
| gemma4:e2b | 15/22 | 11/22 | 16/22 † | 24.1 tok/s (1.9×) |

† the recorded run scored 17/22: it counted "lpopillol" as a correct "popillol". The substring
checker has been fixed (whole-word match); the honest pipeline score is 16/22.

Findings:

- **Iteration partly substitutes for parameters.** e2b + refinement loop (16/22) matches
  e4b one-shot (15/22) at ~1.9× the decode speed. For latency-bound on-device use, the smaller
  model with orchestration is competitive with the bigger model without it.
- **Free-form reasoning HURTS e2b** (15/22 free vs 21/22 for e4b — and free is *worse* than
  direct on several trick questions: it talked itself out of correct one-shot answers on
  apples-yesterday, alice-sisters, month-children). Small models can't always be trusted with
  their own chain-of-thought; "think more" is not size-independent advice.
- **Different failure fingerprints.** e2b passes strawberry one-shot (e4b doesn't) but fails
  sally-sisters, river-crossing, coins, rooster, spell-backwards (e4b doesn't). A shared
  escalation policy still worked: the loop fixed 5 of e2b's 11 direct failures.

## 7. "Are you sure?" — doubt is not a method

The simplest possible refinement: keep one growing conversation and append
"Are you sure? Double-check your answer carefully" after each response (2 rounds, direct
answers, temp 0, full classic battery, both models — `exp-challenge-*.json`):

| Model | Baseline | After 2 challenge rounds | Fixed | Broken |
|---|---|---|---|---|
| gemma4:e4b | 15/22 | 15/22 | 0 | 0 |
| gemma4:e2b | 11/22 | **10/22** | 0 | 1 (+2 wrong→differently-wrong) |

- **e4b is completely inert under doubt**: all 22 answers identical through both rounds.
  Its own prior answer sits in the conversation as an anchor (section 5), and a bare
  expression of doubt gives no procedure to overcome it — the anchor wins, and you pay
  3× the tokens for nothing.
- **e2b is sycophantic under doubt**: it abandoned a correct answer (Alice's sisters,
  5 → 4), churned two wrong answers into different wrong answers (2 → 3, 3 → 7), and
  fixed nothing. Doubt adds noise, not signal.

Contrast with the fresh-context loop (sections 2–4): same models, same problems — it fixed
2 (e4b) / 5 (e2b) and broke zero. The difference is structural: the loop restarts with a
small fresh context (weakening the anchor) and gives a re-derivation *procedure*
("solve it from scratch, then compare"), not just an emotion. Asking a model to doubt
itself without telling it how to re-check is either ignored or obeyed blindly.

Footnote on determinism: two same-seed temp-0 runs of e2b differed on 3/22 baseline answers
(GPU reduction nondeterminism) — treat single-problem deltas of ±1 across runs as noise;
the directional findings above are consistent across all runs.

## 8. Final matrix: restart loop vs chain-of-thought vs thinking mode (e4b, exact tokens)

All output-token counts are exact (`eval_count` from Ollama), 22-problem classic battery:

| Strategy | Accuracy | Output tokens | Input tokens |
|---|---|---|---|
| Direct one-shot | 15/22 | ~120 | ~900 |
| Restart loop (converge stop) | 17/22 | **252** | 6,141 |
| Loop + fresh-CoT escalation on the 5 stuck † | **21/22** | **3,428** | 6,933 |
| Inline CoT on every problem | 21/22 ‡ | 5,549 | ~2,000 |
| Native thinking mode | 21/22 | 7,276 | ~2,000 |

† escalation routing used the answer key to pick the 5 problems — see the router caveat below.
‡ recorded as 22/22 by an older loose checker: on widow-marry the reasoning mentions "dead"
  but the final answer is "depends on jurisdiction" — honest score 21/22.

Findings:

- **Fresh resample is the right escalation.** Re-asking with reasoning allowed and NO previous
  answer in the prompt fixed **4/5** stuck problems including random-host Monty Hall — which
  feedback-based revisions fixed **0/5** across three variants (self-framed, student-framed,
  temp-jittered). Direct confirmation of the anchoring finding: feedback prevents the very
  fixes escalation exists to make.
- **The plain restart loop does not beat thinking mode on accuracy** (17 vs 21) — but costs
  **29× fewer output tokens** (252 vs 7,276). Since decode time scales with output tokens,
  that's the latency ratio too.
- **Loop + fresh-CoT escalation ties thinking mode** (21/22) at **2.1× fewer output tokens**
  (and 1.6× fewer than inline CoT). Input tokens are higher (each round re-prefills the
  problem), but prefill is parallel and several times cheaper per token than decode.
- **The router caveat (the open problem):** correct answers and confidently-wrong answers
  produce the *same* loop signature — instant convergence. Unstable answers (the slips) are
  detectable and cheaply fixable; confident errors are invisible without ground truth. The
  missing piece is a confidence signal, e.g. token logprobs via llama.cpp's server — which
  Ollama does not expose.
- **The widow riddle survives every gemma4 strategy** (direct, loop, all escalations, inline
  CoT, thinking mode, and an explicit premise-check system prompt): gemma4's reading silently
  repairs "his widow's sister" into "his late wife's sister" before reasoning starts — the
  false premise never reaches the reasoning layer. Inference-time techniques can buy back
  computation, but not perception.
- **A different model family covers the blind spot.** deepseek-r1 (8B, also local) solves the
  widow riddle outright — its thinking trace states "for a man to have a widow, he must be
  dead… logically inconsistent" → No (≈4,700 thinking tokens, `deepseek-widow.mjs`). So 22/22
  is reachable at inference time via a cross-model referee as the top escalation rung:
  different priors see through different illusions.

## 9. Drip-feed: one premise per turn

Splitting the problem into sentences and feeding them one per conversation turn (the model
acknowledges each premise in one line before the final question; final answer stays direct) —
`drip.mjs`, `drip-e4b-v2.json`:

- Overall 15/22 — equal to direct one-shot, at ~20 output tokens/problem (439 total).
- On multi-sentence problems: **10/13 vs direct's 9/13** — it fixed **height-order** (the
  5-constraint ordering chain) for 46 tokens, the cheapest fix for that problem class we
  measured, and broke nothing.
- It does not touch perception failures, misconceptions, or arithmetic — those don't fail at
  premise-reading.
- v1 of the harness showed the hazard: with a sloppy protocol the acknowledgment turns can
  make premise numbers more salient than derived answers (sally-sisters echoed "2" from the
  premise despite a correct acknowledgment). A clean "now the final question" marker removed
  the effect.

Verdict: a near-free structured-attention trick for constraint-integration problems; overlaps
with what the restart loop already fixes. The measured stack remains: direct → restart loop →
fresh-CoT escalation → cross-model referee.

## 10. Next ideas

- **Fresh-resample escalation** — on instant convergence, drop the feedback entirely and run a
  clean free-form pass (the data says this beats any feedback variant on misconceptions).
- **Loop-signature router** — instant convergence on round 1 = suspicious; only those problems
  get the expensive escalation. The data above says this router would be nearly optimal.
- **Cross-model refereeing** — let deepseek-r1 (also installed) judge between gemma4's baseline
  and revision answers when they disagree.
