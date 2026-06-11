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

## 6. Next ideas

- **Fresh-resample escalation** — on instant convergence, drop the feedback entirely and run a
  clean free-form pass (the data says this beats any feedback variant on misconceptions).
- **Loop-signature router** — instant convergence on round 1 = suspicious; only those problems
  get the expensive escalation. The data above says this router would be nearly optimal.
- **Cross-model refereeing** — let deepseek-r1 (also installed) judge between gemma4's baseline
  and revision answers when they disagree.
