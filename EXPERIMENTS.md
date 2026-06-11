# The experiments, explained

Every experiment below follows the same recipe: a fixed battery of reasoning problems with
machine-checkable answers, deterministic settings (temperature 0, fixed seeds, thinking off
unless stated), and exact output-token counts from Ollama's `eval_count`. Models:
`gemma4:e4b` (= `gemma4:latest`, identical digest) and `gemma4:e2b`, run locally.
Headline numbers live in [RESULTS.md](RESULTS.md); this file explains what each experiment
*does* and *why it works the way it does*.

A core mechanism to keep in mind throughout: a transformer spends a **fixed amount of
computation per generated token** (one pass through its layers). Multi-step problems need
more serial computation than one pass provides. Every technique below is a different way of
buying — or failing to buy — extra computation.

---

## 1. One-shot probes — finding what fails

**Question:** what does the model get wrong with no help at all?
**How it works:** each problem is asked once. Two answer styles: *free-form* (the model may
write out reasoning before its `FINAL:` line — inline chain-of-thought) and *direct* (the
prompt forbids any visible reasoning: "answer with only one line"). A checker validates the
extracted answer (number match / word match / keyword groups).

```
node probe.mjs  --style free      # classic 22-problem battery
node probe.mjs  --style direct
node probe2.mjs --style free      # harder 14-problem battery
```

**Result:** free-form 21/22 + 13/14; direct 15/22. The gap *is* chain-of-thought's value:
with reasoning text banned, the model must solve everything within one token's worth of
computation, and multi-step problems collapse.
**Watch out for:** generation caps. An early "failure" (random-host Monty Hall) was actually
the model running out of `num_predict` tokens mid-reasoning — truncation looks identical to
inability. Probes now use generous caps.

## 2. The restart loop — iterate instead of thinking long

**Question:** can repeated *short* attempts substitute for one long reasoning trace?
**How it works:** attempt 0 answers the problem. Each later round starts a **fresh, tiny
context** containing only the problem and the previous attempt, with instructions to re-read
carefully, solve from scratch, compare, and answer. The loop stops when the answer repeats
in consecutive rounds ("convergence" — an honest stop rule that uses no answer key). Each
round buys a full extra prefill+decode of computation while context stays ~200 tokens.

```
node experiment.mjs --style direct --rounds 4 --feedback full --set classic
```

**Result:** 15/22 → 17/22, zero correct answers broken in hundreds of revision rounds.
It fixes *unstable* errors — careless slips where re-reading changes the answer (date
arithmetic, ordering). It cannot move *stable* errors: a confidently-wrong model just
reproduces its answer, converging instantly on the wrong value.

## 3. Escalation A: temperature jitter — a negative result that matters

**Question:** are the stuck wrong answers just unlucky samples that randomness could flip?
**How it works:** same loop, but revision rounds sample at temperature 0.8 with different
seeds. If wrongness were sampling noise, jitter would escape it; majority voting across
rounds scores the outcome.

```
node experiment.mjs --style direct --revisionTemp 0.8 --rounds 6 --only <the 5 stuck ids>
```

**Result:** 0/5 — the *identical* wrong token sequence reappeared all six rounds on every
problem. Confidently-wrong answers are the model's strong mode, not variance. Don't reach
for temperature to fix correctness.

## 4. Escalation B: reasoning in revisions

**Question:** what if the cheap direct loop could *think* during revision rounds only?
**How it works:** identical loop, except the revision rounds' instruction permits written
reasoning. Mechanically this restores the scratchpad: writing "S-T-R-A-W-B-E-R-R-Y"
re-tokenizes a word into visible letters; writing intermediate sums gives later tokens
something to build on.

```
node experiment.mjs --style direct --revisionStyle free --rounds 3 --only <the 5 stuck ids>
```

**Result:** 3/5 fixed in a single reasoning round each. The two survivors (the widow riddle,
random-host Monty Hall) were special: the model solves both one-shot — but not when its own
wrong answer is in the prompt. That observation triggered experiments 5–7.

## 5. De-anchoring — whose answer is it anyway?

**Question:** does the model defend its *own* answers, or any answer it can see?
**How it works:** same as Escalation B, but the previous attempt is presented as "another
student's attempt", with an explicit warning that students often fall for trick questions.
If self-attachment caused the failures, third-person framing should free it.

```
node experiment.mjs --style direct --revisionStyle free --framing student --rounds 3 --only <ids>
```

**Result:** identical 3/5. The anchor is the **presence of a proposed answer**, not whose it
is. Attention conditions on everything in context, and training data overwhelmingly shows
stated answers being confirmed — so any visible candidate answer pulls generation toward
agreement.

## 6. "Are you sure?" — doubt is not a method

**Question:** does the simplest possible self-check — appending "Are you sure?" — help?
**How it works:** unlike the restart loop, this keeps **one growing conversation**: question,
answer, "Are you sure? Double-check carefully," answer, repeat. The model sees its full
history (maximum anchor strength), and the challenge carries a social signal ("the user
thinks I'm wrong") but no procedure.

```
node experiment.mjs --mode challenge --style direct --rounds 2 --model gemma4:e4b
```

**Result:** e4b: completely inert — all 22 answers identical through both rounds. e2b:
sycophantic — abandoned a correct answer, churned wrong ones into different wrong ones,
fixed nothing (11/22 → 10/22). Doubt without a re-derivation procedure is ignored by the
big model and blindly obeyed by the small one. The restart loop wins on both counts because
it provides *procedure* (solve from scratch, then compare) in a *fresh context* (weak anchor).

## 7. Fresh resample — the winning escalation

**Question:** if visible answers anchor, what happens when escalation shows *nothing*?
**How it works:** when the loop signals trouble, re-ask the problem **clean** — free-form
reasoning allowed, no previous attempt in the prompt at all — then one confirm round.

```
node experiment.mjs --style direct --revisionStyle free --feedback none --rounds 2 --only <ids>
```

**Result:** 4/5 — including random-host Monty Hall, which every feedback variant (self-framed,
student-framed, temp-jittered) fixed 0/5. Removing the answer removes the anchor. Rule of
thumb that fell out: **when escalating, never show the model what it said before.**

## 8. Thinking mode — the native reasoning channel

**Question:** how does the model's built-in hidden thinking compare?
**How it works:** same one-shot probe with `think: true`. Mechanically identical to inline
CoT (generated tokens as scratchpad), but wrapped in trained tags and hidden from the answer.

```
node probe.mjs --style direct --think true --predict 4096
```

**Result:** e4b 21/22 at 7,276 output tokens — same accuracy as inline CoT (5,549) at 31%
more cost; the most expensive way to buy 21/22. e2b 17/22 at 9,563 tokens: the smaller model
thinks *more* and gains *less* — verbose thinking is often struggle, not progress.

## 9. Model-size frontier — e2b vs e4b

**Question:** can a smaller model plus orchestration replace a bigger model?
**How it works:** `compare.mjs` runs the full battery per model (both styles), then applies
the winning loop strategy to that model's own failures, recording accuracy and tok/s.

```
node compare.mjs --models gemma4:e2b,gemma4:e4b --rounds 3
```

**Result:** e2b + loop (16/22) ≈ e4b one-shot (15/22) at 1.9× the decode speed — iteration
partly substitutes for parameters. Caution: free-form reasoning *hurts* e2b (15/22 free vs
21/22 for e4b; it talks itself out of memorized correct answers). Small models shouldn't be
trusted with their own chain-of-thought.

## 10. Drip-feed — one premise per turn

**Question:** does feeding the problem sentence-by-sentence (model acknowledges each premise
before the question arrives) improve understanding?
**How it works:** multi-sentence problems are split; each sentence is a user turn, the model
replies with one line of "what I now know", then the final question arrives clearly marked.
Forces attention on every premise; single-sentence problems run unchanged as controls.

```
node drip.mjs --model gemma4:e4b --style direct
```

**Result:** +1 problem net (the 5-constraint ordering puzzle) for ~20 tokens — the cheapest
fix measured for constraint-integration failures — and nothing else. Hazard found in v1: with
a sloppy protocol the acknowledgments make premise numbers more salient than derived answers
(premise-echo anchoring). It can't help failures that don't stem from premise-reading.

## 11. Tool use — deleting failure classes

**Question:** what happens when the model can call a calculator and string utilities?
**How it works:** Ollama tool-calling with a generic toolbox (`calculate`,
`count_occurrences`, `count_words`, `reverse_string`). Letter counting fails because the
tokenizer destroys characters before the model sees them; arithmetic fails because one token
gets one pass of compute. Tools route both to code, which has neither limitation.

```
node tools.mjs --model gemma4:e4b
```

**Result:** 15/22 → **18/22 at 399 output tokens** — the best accuracy-per-token of any
strategy. All 9 tool invocations were sensible. Tools do nothing for conceptual failures,
and the calendar problem shows the boundary: the model reached for the calculator but gave
it the wrong job.

## 12. The full stack — and why it backfired

**Question:** tools (+3) + loop (+2) + fresh-CoT escalation (+4-ish) — do the gains add up?
**How it works:** `pipeline.mjs` runs all three rungs in sequence on every problem, tools
available throughout, exact tokens per stage.

```
node pipeline.mjs --model gemma4:e4b
```

**Result:** 19/22 at 5,707 tokens — *worse* than the best single configs. The aggressive
tool instruction ("whenever a question involves arithmetic, USE A TOOL") acts as a global
interpretation modifier: it recast a trick question as a subtraction (3−2=1) even in rounds
that called no tool, causing the restart loop's first-ever regressions. Techniques fix
specific failure classes; stacked indiscriminately, their side effects collide. Route, don't
stack.

## 13. Cross-model referee — different priors, different blind spots

**Question:** is the one unfixable problem (the widow riddle) unfixable for every model?
**How it works:** gemma4 silently "repairs" the impossible premise ("his widow's sister" →
"his late wife's sister") during reading — the trick never reaches its reasoning, which is
why no prompt, loop, or thinking mode helps (even an explicit premise-check instruction
bounced off). deepseek-r1, a different model family, reads the same question.

```
node deepseek-widow.mjs
```

**Result:** deepseek-r1 nails it ("for a man to have a widow, he must be dead… logically
inconsistent" → No). 22/22 is therefore reachable at inference time — but only by adding a
second model as the top escalation rung. Inference-time techniques buy computation; they
can't buy perception.

## 14. Speed — where the time actually goes

**Question:** what makes on-device inference faster?
**How it works:** decode is memory-bandwidth-bound — every generated token reads all model
weights once — so latency ≈ output tokens ÷ (bandwidth/model size). We measured both factors:
token counts above, and backend speed via `llama-bench` (CPU vs Vulkan iGPU on the same
GGUF), plus a `llama-server` logprobs check (the per-token confidence signal Ollama hides,
needed to route escalation without an answer key).

**Result:** orchestration cut output tokens ~14× (direct+tools vs CoT); the GPU backend adds
1.4× (Vulkan on Iris Xe: 4.04 → 5.83 tok/s decode — capped by the shared memory bus).
Optimize tokens first, silicon second. Gotchas recorded: Ollama runs CPU-only on Intel iGPU
machines; Ollama's gemma4 e-variant blobs load only in Ollama's own engine (use community
GGUFs with llama.cpp); speculative decoding e2b→e4b needs ~15.6 GB.

## 15. The vigilance prime — fictional doubt

**Question:** can a system prompt claiming "YOUR PREVIOUS ATTEMPT WAS WRONG" (with no actual
attempt) buy the loop's care at zero extra generations?
**How it works:** the claim primes re-derivation behavior — but unconditionally. The model's
first answer is its argmax, its best guess; an instruction to distrust it deviates from the
best guess on every problem, right or wrong.

```
node probe.mjs --style direct --prime true
```

**Result:** zero fixes in 66 runs; e4b direct 15→13, e2b direct 11→6 (the small model obeys
the doubt hardest), free-form 21→18 plus ~2× slower. Completes the doubt spectrum: doubt
helps only when attached to a real, examinable artifact (the restart loop), never as a blanket
verdict.

## 16. Agreement-based early stopping — verification without an oracle

**Question:** can "two derivations agree" replace an answer key as the stopping/verification
signal?
**How it works:** produce attempts until any two normalized answers match (the script judges
agreement, the model just solves); cap at 4; no match = "unresolved" → escalate. Two designs:
*fresh* (independent attempts, the script varies the solving angle each round) vs *chat*
(growing conversation, "re-solve differently").

```
node agree.mjs --mode fresh --rounds 4
node agree.mjs --mode chat  --rounds 4
```

**Result:** fresh — 20/22 correct, 95% precision-when-agreed, one honest "unresolved" flag,
avg exactly 2 attempts; the best oracle-free score recorded, portable to any chat API. Chat —
86% precision with 3 false agreements, including one where a *correct* first answer was
overwritten by an echoed wrong one. Agreement is evidence only when attempts are independent;
in-context attempts aren't.

---

## The cheat sheet

| If the failure is… | Use… | Because… |
|---|---|---|
| counting / spelling / arithmetic | a tool | tokenizers hide characters; one token = one compute pass |
| a careless slip (unstable answer) | the restart loop | re-reading in a fresh context is cheap and never broke anything |
| a misconception (stable wrong answer) | fresh re-ask with reasoning, **no feedback** | visible answers anchor; reasoning needs a clean slate |
| in the model's *reading* of the question | a different model | priors repair what they expect; no prompt arrives early enough |
| "it's too slow" | fewer output tokens, then better backend | decode cost is linear in tokens; bandwidth caps the rest |
| you must trust an answer with no key | agreement of two **independent** attempts | matching independent derivations are evidence; in-context echoes aren't |
