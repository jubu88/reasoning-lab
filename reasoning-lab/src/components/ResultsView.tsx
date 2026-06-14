// Offline results browser — the recorded findings, organized per method:
// baselines → the restart loop → escalation variants → add-ons → combinations →
// size & speed → routing. Works without Ollama; "re-run live" buttons load a
// scenario into the Refine Lab.

import type { ReactNode } from "react";
import type { Scenario } from "../App";
import { getProblem } from "../lib/problems";
import probeFree from "../data/probe-results.json";
import probeDirect from "../data/probe-direct-results.json";
import probeHard from "../data/probe2-results.json";
import probeThinkE4b from "../data/probe-think-e4b.json";
import probeThinkE2b from "../data/probe-think-e2b.json";
import expDirect from "../data/exp-direct-classic.json";
import expTemp from "../data/exp-temp-revisions.json";
import expHybrid from "../data/exp-hybrid.json";
import expStudent from "../data/exp-student-framing.json";
import challengeE4b from "../data/exp-challenge-e4b.json";
import challengeE2b from "../data/exp-challenge-e2b.json";
import freshResample from "../data/exp-fresh-resample-e4b.json";
import compareE2b from "../data/compare-e2b.json";
import primeE4bDirect from "../data/probe-prime-e4b-direct.json";
import primeE2bDirect from "../data/probe-prime-e2b-direct.json";
import primeE4bFree from "../data/probe-prime-e4b-free.json";
import agreeFresh from "../data/agree-fresh-e4b.json";
import agreeChat from "../data/agree-chat-e4b.json";
import refereeData from "../data/referee-hardset.json";
import toolsNeutral from "../data/tools-e4b-neutral.json";
import dripV2 from "../data/drip-e4b-v2.json";
import pipelineE4b from "../data/pipeline-e4b.json";
import routerData from "../data/router-results.json";

interface ProbeResult {
  id: string;
  pass: boolean;
}

interface ExpAnswer {
  i: number;
  a: string;
  ok: boolean;
}

interface ExpResult {
  id: string;
  baselineCorrect?: boolean;
  finalCorrect?: boolean;
  answers?: ExpAnswer[];
  error?: boolean;
}

type ScenarioBase = Omit<Scenario, "seq" | "problemId">;

interface Experiment {
  title: string;
  config: string;
  takeaway: string;
  results: ExpResult[];
  scenario?: ScenarioBase;
  winner?: boolean;
}

const PROBES = [
  { title: "Free-form · classic battery", data: (probeFree as any).results as ProbeResult[] },
  { title: "Direct answers · classic battery", data: (probeDirect as any).results as ProbeResult[] },
  { title: "Free-form · hard battery", data: (probeHard as any).results as ProbeResult[] },
  { title: "Thinking mode · e4b", data: (probeThinkE4b as any).results as ProbeResult[] },
  { title: "Thinking mode · e2b", data: (probeThinkE2b as any).results as ProbeResult[] },
];

const LOOP_EXP: Experiment = {
  title: "Refinement loop · direct answers",
  config: "4 revision rounds · full-response feedback · temp 0",
  takeaway:
    "15/22 → 17/22 for 252 output tokens. Fixed the weekday slip and the height ordering; never broke a correct answer in hundreds of revision rounds. Confidently-wrong answers did not budge — those need escalation (next section).",
  results: (expDirect as any).results,
  scenario: { answerStyle: "direct", maxIterations: 4, stopMode: "converge", feedbackMode: "full-response", escalate: false, revisionTemp: 0, autoRun: true },
};

const ESCALATION_EXPS: Experiment[] = [
  {
    title: "Temperature 0.8 revisions",
    config: "6 revision rounds · still direct · the 5 stuck problems",
    takeaway:
      "0/5 fixed — the identical wrong answer reappeared every round. Confidently-wrong answers are the model's strong mode, not sampling noise.",
    results: (expTemp as any).results,
    scenario: { answerStyle: "direct", maxIterations: 6, stopMode: "converge", feedbackMode: "full-response", escalate: false, revisionTemp: 0.8, autoRun: true },
  },
  {
    title: "Reasoning in revisions (feedback shown)",
    config: "3 revision rounds · direct baseline, free-form revisions · the 5 stuck problems",
    takeaway:
      "3/5 fixed. The two survivors (widow, Monty Hall) are anchoring: the model solves both one-shot, but confirms its own wrong answer when it can see it.",
    results: (expHybrid as any).results,
    scenario: { answerStyle: "direct", maxIterations: 3, stopMode: "converge", feedbackMode: "full-response", escalate: true, revisionTemp: 0, autoRun: true },
  },
  {
    title: "De-anchoring — framed as a student's attempt",
    config: "same as above, feedback presented as another student's answer",
    takeaway:
      "Identical 3/5 — the anchor is the mere presence of a proposed answer, not self-attribution.",
    results: (expStudent as any).results,
  },
  {
    title: '"Are you sure?" — e4b',
    config: "one growing conversation · 2 doubt rounds appended",
    takeaway:
      "Completely inert: all 22 answers identical through both rounds. Doubt without a re-derivation procedure loses to the anchor, at 3× the cost.",
    results: (challengeE4b as any).results,
  },
  {
    title: '"Are you sure?" — e2b',
    config: "one growing conversation · 2 doubt rounds appended",
    takeaway:
      "Sycophantic: 11/22 → 10/22. Abandoned a correct answer, churned wrong ones, fixed nothing.",
    results: (challengeE2b as any).results,
  },
  {
    title: "Fresh resample — clean re-ask, no previous answer",
    config: "direct baseline → free-form re-ask with NOTHING shown · resample + confirm",
    takeaway:
      "4/5 fixed, including Monty Hall (0/5 for every feedback variant). Removing the answer removes the anchor. The rule: when escalating, never show the model what it said before.",
    results: (freshResample as any).results,
    scenario: { answerStyle: "direct", maxIterations: 2, stopMode: "converge", feedbackMode: "none", escalate: true, revisionTemp: 0, autoRun: true },
    winner: true,
  },
];

const MATRIX = [
  { strategy: "Direct one-shot", acc: "15/22", out: "~120", inp: "~900" },
  { strategy: "Restart loop (converge stop)", acc: "17/22", out: "252", inp: "6,141" },
  { strategy: "Loop + fresh-CoT escalation †", acc: "21/22", out: "3,428", inp: "6,933" },
  { strategy: "Inline CoT everywhere", acc: "21/22 ‡", out: "5,549", inp: "~2,000" },
  { strategy: "Native thinking mode", acc: "7,276 tokens", out: "7,276", inp: "~2,000" },
];

const TOC = [
  { id: "sec-baselines", label: "Baselines" },
  { id: "sec-loop", label: "Restart loop" },
  { id: "sec-escalation", label: "Escalation" },
  { id: "sec-doubt", label: "Doubt" },
  { id: "sec-addons", label: "Tools & drip" },
  { id: "sec-combos", label: "Combinations" },
  { id: "sec-size", label: "Size & speed" },
  { id: "sec-routing", label: "Routing" },
  { id: "sec-agree", label: "Agreement" },
  { id: "sec-referee", label: "Referee" },
  { id: "sec-repro", label: "Reproduce" },
];

function Section({ id, title, lesson, children }: { id: string; title: string; lesson: string; children: ReactNode }) {
  return (
    <section id={id} className="result-section">
      <div className="section-head">
        <div className="section-title">{title}</div>
        <div className="section-lesson">{lesson}</div>
      </div>
      {children}
    </section>
  );
}

function ExpCard({ exp, onLoadScenario }: { exp: Experiment; onLoadScenario: (s: Omit<Scenario, "seq">) => void }) {
  return (
    <div className={`card ${exp.winner ? "winner-card" : ""}`} style={{ marginBottom: 14 }}>
      <div className="card-title">
        {exp.winner && <span className="badge pass" style={{ marginRight: 8 }}>winner</span>}
        {exp.title}
      </div>
      <div className="exp-config">{exp.config}</div>
      <table className="bench" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>Problem</th>
            <th>Answer trail</th>
            <th>Outcome</th>
            {exp.scenario && <th></th>}
          </tr>
        </thead>
        <tbody>
          {exp.results
            .filter((r) => !r.error && r.answers)
            .map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{r.id}</td>
                <td>
                  {r.answers!.map((a, i) => (
                    <span key={i}>
                      {i > 0 && <span className="trail-arrow"> → </span>}
                      <span className={`trail-answer ${a.ok ? "ok" : "bad"}`}>
                        {a.a.length > 26 ? a.a.slice(0, 26) + "…" : a.a}
                      </span>
                    </span>
                  ))}
                </td>
                <td>
                  {r.baselineCorrect ? (
                    r.finalCorrect ? (
                      <span className="badge pass">stayed correct</span>
                    ) : (
                      <span className="badge fail">broken</span>
                    )
                  ) : r.finalCorrect ? (
                    <span className="badge pass">✓ fixed</span>
                  ) : (
                    <span className="badge fail">still wrong</span>
                  )}
                </td>
                {exp.scenario && (
                  <td>
                    {getProblem(r.id) && (
                      <button
                        className="btn small"
                        title="Load this exact configuration into the Refine Lab and run it live"
                        onClick={() => onLoadScenario({ ...exp.scenario!, problemId: r.id })}
                      >
                        ↻ re-run live
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
        </tbody>
      </table>
      <div className="exp-takeaway">{exp.takeaway}</div>
    </div>
  );
}

export default function ResultsView({
  onLoadScenario,
}: {
  onLoadScenario: (s: Omit<Scenario, "seq">) => void;
}) {
  const routerRows = [...((routerData as any).results as any[])]
    .filter((r) => !r.error)
    .sort((a, b) => a.minP - b.minP);

  return (
    <>
      <div className="view-header">
        <span className="view-title">Results</span>
        <span className="view-desc">
          Recorded findings for <b>gemma4</b> (e4b/e2b, temp 0) — organized per method. Works
          without Ollama; ↻ buttons reproduce any run live.
        </span>
      </div>
      <div className="view-body">
        <div className="results-pipeline">
          <div className="pipe-step">
            <div className="pipe-num">15<span>/22</span></div>
            <div className="pipe-label">one-shot, direct</div>
          </div>
          <div className="pipe-arrow">→</div>
          <div className="pipe-step">
            <div className="pipe-num">17<span>/22</span></div>
            <div className="pipe-label">+ restart loop</div>
          </div>
          <div className="pipe-arrow">→</div>
          <div className="pipe-step accent">
            <div className="pipe-num">21<span>/22</span></div>
            <div className="pipe-label">+ fresh-CoT escalation</div>
          </div>
          <div className="pipe-arrow">→</div>
          <div className="pipe-step accent">
            <div className="pipe-num">22<span>/22</span></div>
            <div className="pipe-label">+ cross-model referee</div>
          </div>
        </div>

        <div className="results-toc">
          {TOC.map((t) => (
            <button key={t.id} className="chip toc-chip" onClick={() => document.getElementById(t.id)?.scrollIntoView({ behavior: "smooth" })}>
              {t.label}
            </button>
          ))}
        </div>

        <Section
          id="sec-baselines"
          title="Baselines — what the model does alone"
          lesson="Free-form reasoning is accurate but slow; direct answers are fast but fall into traps; native thinking matches CoT accuracy at the highest token cost of anything measured."
        >
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="probe-grid">
              {PROBES.map((p) => {
                const pass = p.data.filter((r) => r.pass).length;
                return (
                  <div key={p.title} className="probe-tile">
                    <div className="probe-score">{pass}/{p.data.length}</div>
                    <div className="probe-name">{p.title}</div>
                    <div className="probe-fails">
                      {p.data.filter((r) => !r.pass).length > 0
                        ? "fails: " + p.data.filter((r) => !r.pass).map((r) => r.id).join(", ")
                        : "no failures"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Section>

        <Section
          id="sec-loop"
          title="The restart loop — the core idea"
          lesson="Answer, then restart with a fresh tiny context holding only the problem + previous attempt, and re-derive. Stop when the answer repeats. +2 accuracy, zero breaks ever, 29× cheaper than thinking mode."
        >
          <ExpCard exp={LOOP_EXP} onLoadScenario={onLoadScenario} />
        </Section>

        <Section
          id="sec-escalation"
          title="Escalation — when the answer won't move"
          lesson="Every variant that shows the model an answer fails on misconceptions (anchoring); jitter does nothing; doubt is inert or harmful. The clean re-ask with reasoning wins: 4/5."
        >
          {ESCALATION_EXPS.map((exp) => (
            <ExpCard key={exp.title} exp={exp} onLoadScenario={onLoadScenario} />
          ))}
        </Section>

        <Section
          id="sec-doubt"
          title="The vigilance prime — fictional doubt as a system prompt"
          lesson='Injecting "YOUR PREVIOUS ATTEMPT WAS WRONG" with no actual attempt: zero fixes in 66 runs, breaks right answers everywhere, ~2× slower in free mode. The first answer is the model&apos;s best guess — unconditional doubt orders deviation from it. Doubt only works attached to a real, examinable previous answer.'
        >
          <div className="card" style={{ marginBottom: 14 }}>
            <table className="bench">
              <thead>
                <tr><th>Configuration</th><th>Baseline</th><th>+ vigilance prime</th><th>Broke</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>e4b · direct</td>
                  <td>15/22</td>
                  <td className="bench-answer">{(primeE4bDirect as any).results.filter((r: any) => r.pass).length}/22</td>
                  <td className="bench-expected">alice-sisters, rooster-egg</td>
                </tr>
                <tr>
                  <td>e2b · direct</td>
                  <td>11/22</td>
                  <td className="bench-answer">{(primeE2bDirect as any).results.filter((r: any) => r.pass).length}/22</td>
                  <td className="bench-expected">seven of its correct answers</td>
                </tr>
                <tr>
                  <td>e4b · free-form</td>
                  <td>21/22</td>
                  <td className="bench-answer">{(primeE4bFree as any).results.filter((r: any) => r.pass).length}/22</td>
                  <td className="bench-expected">strawberry → "4", spelling → "popillop", 2 timeouts</td>
                </tr>
              </tbody>
            </table>
            <div className="exp-takeaway">
              The doubt spectrum, complete: "are you sure?" (sees answer + pressure) → inert or sycophantic;
              vigilance prime (sees a verdict, no answer) → breaks right answers; restart loop (sees a candidate +
              a procedure) → fixes slips, breaks nothing; fresh resample (sees nothing) → fixes misconceptions.
              Assert less, let it re-derive more.
            </div>
          </div>
        </Section>

        <Section
          id="sec-addons"
          title="Add-ons — tools & input shaping"
          lesson="A four-function toolbox deletes the counting and arithmetic failure classes (15/22 → 19/22) — but only with a gentle prompt; commanding tool use recasts riddles as math. Drip-feeding premises helps only constraint-integration problems."
        >
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">Tool use — neutral prompt (the fixed recipe)</div>
            <div className="exp-config">
              calculate · count_occurrences · count_words · reverse_string — "use one only when it is an exact fit"
            </div>
            <table className="bench" style={{ marginTop: 10 }}>
              <thead>
                <tr><th>Problem</th><th>Tools called</th><th>Answer</th><th>Result</th></tr>
              </thead>
              <tbody>
                {((toolsNeutral as any).results as any[]).filter((r) => !r.error).map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{r.id}</td>
                    <td className="bench-expected">
                      {r.toolCalls?.length
                        ? r.toolCalls.map((t: any) => `${t.name}→${String(t.result).slice(0, 10)}`).join(", ")
                        : "—"}
                    </td>
                    <td className="bench-answer">{(r.extracted ?? "").slice(0, 30)}</td>
                    <td>{r.pass ? <span className="badge pass">✓</span> : <span className="badge fail">✗</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="exp-takeaway">
              19/22 at 574 output tokens. The earlier pushy prompt ("whenever a question involves arithmetic, USE A
              TOOL") scored 18/22 but recast trick questions as calculations — interference cured by this wording.
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">Drip-feed — one premise per turn</div>
            <div className="exp-config">multi-sentence problems split; model acknowledges each premise before the question</div>
            <table className="bench" style={{ marginTop: 10 }}>
              <thead>
                <tr><th>Problem</th><th>Sentences</th><th>Answer</th><th>Result</th></tr>
              </thead>
              <tbody>
                {((dripV2 as any).results as any[]).filter((r: any) => r.dripped).map((r: any) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{r.id}</td>
                    <td className="bench-expected">{r.sentences}</td>
                    <td className="bench-answer">{(r.extracted ?? "").slice(0, 30)}</td>
                    <td>{r.pass ? <span className="badge pass">✓</span> : <span className="badge fail">✗</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="exp-takeaway">
              10/13 on multi-sentence problems vs 9/13 direct — fixed the 5-constraint ordering chain for 46 tokens,
              broke nothing. Doesn't reach failures that aren't about premise-reading.
            </div>
          </div>
        </Section>

        <Section
          id="sec-combos"
          title="Combinations — stacking vs routing"
          lesson="Stacking everything (19/22 at 5,707 tokens) scored worse than the best parts: a pushy global tool prompt poisoned the loop's re-reading. Techniques fix specific failure classes — route them, don't stack them."
        >
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">Full pipeline — tools + loop + escalation, per-problem path</div>
            <table className="bench" style={{ marginTop: 10 }}>
              <thead>
                <tr><th>Problem</th><th>① direct+tools</th><th>② +loop</th><th>③ +escalation</th><th>Final</th></tr>
              </thead>
              <tbody>
                {((pipelineE4b as any).results as any[]).filter((r: any) => !r.error).map((r: any) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{r.id}</td>
                    {["s1", "s2", "s3"].map((k) => (
                      <td key={k}>
                        {r.stages?.[k] ? (
                          <span className={`trail-answer ${r.stages[k].correct ? "ok" : "bad"}`}>
                            {String(r.stages[k].answer ?? "").slice(0, 18)}
                          </span>
                        ) : (
                          <span className="trail-arrow">—</span>
                        )}
                      </td>
                    ))}
                    <td>{r.final?.correct ? <span className="badge pass">✓</span> : <span className="badge fail">✗</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="exp-takeaway">
              Watch apples-yesterday: correct at stage ①, then broken by the loop under the pushy tool prompt — the
              first loop regression ever recorded, caused by prompt interference, not the loop itself.
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">The cost-accuracy matrix (exact output tokens, e4b)</div>
            <table className="bench" style={{ marginTop: 10 }}>
              <thead>
                <tr><th>Strategy</th><th>Accuracy</th><th>Output tokens</th><th>Input tokens</th></tr>
              </thead>
              <tbody>
                {MATRIX.slice(0, 4).map((m) => (
                  <tr key={m.strategy}>
                    <td>{m.strategy}</td>
                    <td>{m.acc}</td>
                    <td className="bench-answer">{m.out}</td>
                    <td className="bench-answer">{m.inp}</td>
                  </tr>
                ))}
                <tr>
                  <td>Native thinking mode</td>
                  <td>21/22</td>
                  <td className="bench-answer">7,276</td>
                  <td className="bench-answer">~2,000</td>
                </tr>
              </tbody>
            </table>
            <div className="exp-takeaway">
              † escalation routed by answer key in this run — see the Routing section for the deployable version.
              ‡ a loose checker counted one wrong answer as right; honest score shown.
            </div>
          </div>
        </Section>

        <Section
          id="sec-size"
          title="Model size & speed"
          lesson="e2b + restart loop ≈ e4b one-shot at 1.9× decode speed — iteration partly substitutes for parameters. Orchestration is a 14× latency lever; GPU backends are 1.4× (and a net loss on Exynos phones)."
        >
          <div className="card" style={{ marginBottom: 14 }}>
            <table className="bench">
              <thead>
                <tr><th>Model</th><th>Free-form</th><th>Direct</th><th>Direct + loop</th><th>Decode speed</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>gemma4:e4b (= :latest)</td><td>21/22</td><td>15/22</td><td>17/22 (21/22 w/ escalation)</td><td>12.9 tok/s</td>
                </tr>
                <tr>
                  <td>gemma4:e2b</td><td>15/22 *</td><td>11/22</td><td>16/22</td><td>24.1 tok/s (1.9×)</td>
                </tr>
              </tbody>
            </table>
            <div style={{ marginTop: 10 }}>
              {((compareE2b as any).summary[0].refined as any[]).map((r: any) => {
                const reallyFixed = r.fixed && r.id !== "spell-backwards";
                return (
                  <div key={r.id} style={{ marginBottom: 6 }}>
                    <span className="chip" style={{ marginRight: 8 }}>{r.id}</span>
                    {r.trail.map((a: string, i: number) => (
                      <span key={i}>
                        {i > 0 && <span className="trail-arrow"> → </span>}
                        <span className={`trail-answer ${i === r.trail.length - 1 && reallyFixed ? "ok" : "bad"}`}>
                          {a.length > 22 ? a.slice(0, 22) + "…" : a}
                        </span>
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="exp-takeaway">
              * free-form reasoning HURTS e2b — it talks itself out of memorized correct answers. Small models can't
              be trusted with their own chain-of-thought. Speed side: Vulkan on this machine's iGPU = +44% decode;
              on Exynos phones Vulkan runs but prefill collapses ~11× (see EXYNOS-VULKAN.md in the repo) — model
              size and token count are the levers, not the runtime.
            </div>
          </div>
        </Section>

        <Section
          id="sec-routing"
          title="Routing — the confidence signal"
          lesson="Greedy decoding hides uncertainty: answers that never change under any behavioral pressure can still sit near p=0.5 at the logit level. Answer-token logprobs catch 6/6 wrong answers with no answer key."
        >
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">Answer confidence vs correctness (llama-server logprobs, sorted by confidence)</div>
            <div className="exp-config">minP = lowest token probability in the answer span · escalation threshold ≈ 0.94</div>
            <table className="bench" style={{ marginTop: 10 }}>
              <thead>
                <tr><th>Problem</th><th>Answer</th><th>minP</th><th></th><th>Correct?</th></tr>
              </thead>
              <tbody>
                {routerRows.map((r: any) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{r.id}</td>
                    <td className="bench-answer">{(r.extracted ?? "").slice(0, 24)}</td>
                    <td className="bench-answer">{r.minP.toFixed(3)}</td>
                    <td style={{ minWidth: 110 }}>
                      <div className="minp-bar">
                        <div className={`minp-fill ${r.correct ? "ok" : "bad"}`} style={{ width: `${Math.round(r.minP * 100)}%` }} />
                      </div>
                    </td>
                    <td>{r.correct ? <span className="badge pass">✓</span> : <span className="badge fail">✗</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="exp-takeaway">
              Correct answers: minP avg 0.913. Wrong answers: 0.553. Escalating below ~0.94 catches every wrong
              answer at 3 false alarms (9/22 escalated on this adversarial battery; far fewer on normal traffic).
              n=22 — threshold is sample-fitted; treat as proof of signal, not a production constant.
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">The signal that does NOT work — behavioral instability routing</div>
            <div className="exp-config">
              two cheap direct attempts; agree → accept, disagree → escalate to CoT (no logprobs, any API)
            </div>
            <table className="bench" style={{ marginTop: 10 }}>
              <thead>
                <tr><th></th><th>Result</th></tr>
              </thead>
              <tbody>
                <tr><td>Tier-1 only (first attempt)</td><td className="bench-answer">19/22</td></tr>
                <tr><td>After behavioral routing</td><td className="bench-answer">18/22 — worse</td></tr>
                <tr><td>Escalated</td><td>3/22 — only 1 was actually wrong</td></tr>
                <tr><td>Missed (stable but wrong)</td><td className="bench-expected">height-order, monty-random-host</td></tr>
              </tbody>
            </table>
            <div className="exp-takeaway">
              It went backwards. <b>Confident errors are stable</b> — two temp-0 attempts agree even when wrong, so
              disagreement misses the systematic failures; and escalating an unstable-but-correct answer to CoT can
              break it (widow: "No" → CoT → "Yes"). Instability is a weak error signal on a deterministic model.
              Use logit confidence where you control the server, varied-angle agreement (next) where you don't —
              two near-identical attempts buy nothing.
            </div>
          </div>
        </Section>

        <Section
          id="sec-agree"
          title="Agreement stopping — verification without an oracle"
          lesson="Produce attempts until any two independent answers match (the script judges); no match in 4 = escalate. Fresh-context agreement is evidence (95% precision); conversational agreement is echo (a correct first answer got overwritten by an agreed-upon wrong one)."
        >
          <div className="card" style={{ marginBottom: 14 }}>
            <table className="bench">
              <thead>
                <tr><th></th><th>Fresh (independent)</th><th>Chat (conversation)</th></tr>
              </thead>
              <tbody>
                <tr><td>Resolved by agreement</td><td>21/22 · avg 2.0 attempts</td><td>22/22 · avg 2.0</td></tr>
                <tr><td>Correct when agreed</td><td className="bench-answer">20/21 (95%)</td><td className="bench-answer">19/22 (86%)</td></tr>
                <tr><td>False agreements</td><td>1 (widow)</td><td>3 (incl. spell-backwards echo)</td></tr>
                <tr><td>Unresolved → escalate</td><td>1 (rooster — 4 right answers, 4 phrasings)</td><td>0</td></tr>
                <tr><td>Output tokens (battery)</td><td className="bench-answer">15,463</td><td className="bench-answer">11,469</td></tr>
              </tbody>
            </table>
            <div style={{ marginTop: 10 }}>
              {[
                { label: "fresh · monty-random-host", rows: (agreeFresh as any).results.find((r: any) => r.id === "monty-random-host") },
                { label: "chat · spell-backwards", rows: (agreeChat as any).results.find((r: any) => r.id === "spell-backwards") },
              ].map((x) => (
                <div key={x.label} style={{ marginBottom: 6 }}>
                  <span className="chip" style={{ marginRight: 8 }}>{x.label}</span>
                  {x.rows?.attempts.map((a: any, i: number) => (
                    <span key={i}>
                      {i > 0 && <span className="trail-arrow"> | </span>}
                      <span className={`trail-answer ${a.correct ? "ok" : "bad"}`}>
                        {(a.extracted || "…").slice(0, 22)}
                      </span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <div className="exp-takeaway">
              Round-5 extension: e4b fresh reached <b>21/22 with 100% precision and zero false agreements</b> —
              and cracked the widow riddle (trail: Yes | No | No, the "watch for traps" angle caught the false
              premise twice independently) — the strongest gemma4-only configuration of the project. On e2b,
              precision drops to 81%: small-model errors correlate across angles, so agreement weakens with model
              size. Needs no logprobs and no special runtime — ports to any chat API. Use the logprobs router
              where you control the server; agreement where you don't.
            </div>
          </div>
        </Section>

        <Section
          id="sec-referee"
          title="Cross-model referee — different priors, different blind spots"
          lesson="A different model family re-solves what gemma fundamentally can't see. deepseek-r1 cracked the widow riddle and the ordering puzzle — gemma's weight-level failures — taking the pipeline 18 → 20/22. The top, most expensive escalation rung."
        >
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">deepseek-r1 on gemma's four persistent hard failures</div>
            <table className="bench" style={{ marginTop: 10 }}>
              <thead>
                <tr><th>Problem</th><th>gemma (every method)</th><th>deepseek-r1 referee</th><th></th></tr>
              </thead>
              <tbody>
                {[
                  { id: "widow-marry", gemma: '"Yes" — premise repair' },
                  { id: "height-order", gemma: '"Emma"' },
                  { id: "monty-random-host", gemma: '"Switch"' },
                  { id: "rooster-egg", gemma: "wrong / unphrased" },
                ].map((row) => {
                  const r = (refereeData as any).refereeResults[row.id];
                  const ans = r?.error ? "(stream error)" : r?.extracted?.trim() ? r.extracted : "(no answer — over-thought)";
                  return (
                    <tr key={row.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{row.id}</td>
                      <td className="bench-expected">{row.gemma}</td>
                      <td className="bench-answer">{ans.slice(0, 26)}</td>
                      <td>{r?.correct ? <span className="badge pass">✓ fixed</span> : <span className="badge fail">✗</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="exp-takeaway">
              The referee fixed gemma's two genuine reasoning blind spots — including the widow riddle that survived
              every gemma strategy and native thinking mode. It is not a universal oracle: deepseek over-thinks the
              random-host Monty Hall past 8,000 tokens without concluding, and its "No egg" rooster answer is
              right-in-spirit but misses the keyword checker (the residual is partly our checker). ~5,100 tokens per
              forwarded problem — the top escalation rung, reserved for what cheaper tiers flag. <b>Deployable
              cascade:</b> direct+tools → logprobs router (catches 6/6 errors) → deepseek referee (fixes the
              weight-level ones).
            </div>
          </div>
        </Section>

        <Section
          id="sec-repro"
          title="Reproduce"
          lesson="Every number above regenerates from the scripts in the repo root. Full mechanism explainers: EXPERIMENTS.md."
        >
          <div className="card">
            <pre className="repro-block">{`# from the repo root (Ollama running, gemma4 pulled)
node probe.mjs  --style free        # baselines
node probe.mjs  --style direct
node probe.mjs  --style direct --think true --predict 4096
node experiment.mjs --style direct --rounds 4                      # restart loop
node experiment.mjs --style direct --revisionTemp 0.8 --rounds 6   # escalation A
node experiment.mjs --style direct --revisionStyle free --rounds 3 # escalation B
node experiment.mjs --style direct --revisionStyle free --framing student --rounds 3
node experiment.mjs --mode challenge --style direct --rounds 2     # "are you sure?"
node experiment.mjs --style direct --revisionStyle free --feedback none --rounds 2  # fresh resample
node tools.mjs --sysprompt neutral                                 # tools (fixed recipe)
node drip.mjs                                                      # drip-feed
node pipeline.mjs                                                  # the stack
node compare.mjs --models gemma4:e2b,gemma4:e4b                    # size frontier
node router.mjs --port 8089                                        # confidence router (llama-server)
node router-pipeline.mjs                                           # behavioral router (negative result)
node referee.mjs --ids height-order,monty-random-host,widow-marry,rooster-egg  # cross-model referee`}</pre>
          </div>
        </Section>
      </div>
    </>
  );
}
