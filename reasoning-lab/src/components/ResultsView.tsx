// Offline results browser — renders the bundled probe/experiment data from src/data.
// This view needs no Ollama connection; it exists so the findings are reproducible
// and inspectable anywhere the app runs.

import probeFree from "../data/probe-results.json";
import probeDirect from "../data/probe-direct-results.json";
import probeHard from "../data/probe2-results.json";
import expDirect from "../data/exp-direct-classic.json";
import expTemp from "../data/exp-temp-revisions.json";
import expHybrid from "../data/exp-hybrid.json";
import expStudent from "../data/exp-student-framing.json";
import compareE2b from "../data/compare-e2b.json";
import challengeE4b from "../data/exp-challenge-e4b.json";
import challengeE2b from "../data/exp-challenge-e2b.json";

interface ProbeResult {
  id: string;
  pass: boolean;
  extracted?: string;
  seconds?: number;
}

interface ExpAnswer {
  i: number;
  a: string;
  ok: boolean;
  s: number;
}

interface ExpResult {
  id: string;
  baselineCorrect?: boolean;
  convergedCorrect?: boolean;
  finalCorrect?: boolean;
  answers?: ExpAnswer[];
  error?: boolean;
}

interface Experiment {
  title: string;
  config: string;
  takeaway: string;
  results: ExpResult[];
}

const PROBES = [
  { title: "Free-form answers · classic battery", data: probeFree.results as ProbeResult[] },
  { title: "Direct answers · classic battery", data: probeDirect.results as ProbeResult[] },
  { title: "Free-form answers · hard battery", data: probeHard.results as ProbeResult[] },
];

const EXPERIMENTS: Experiment[] = [
  {
    title: "Refinement loop · direct answers",
    config: "4 revision rounds · full-response feedback · temp 0",
    takeaway:
      "Fixed the weekday slip and (luckily) the height ordering; never broke a correct answer. Confidently-wrong answers did not budge.",
    results: (expDirect as any).results,
  },
  {
    title: "Escalation A — temperature 0.8 revisions",
    config: "6 revision rounds · still direct · the 5 stuck problems",
    takeaway:
      "0/5 fixed. The identical wrong answer reappeared every round — these failures are the model's strong mode, not sampling noise.",
    results: (expTemp as any).results,
  },
  {
    title: "Escalation B — reasoning in revisions",
    config: "3 revision rounds · direct baseline, free-form revisions · the 5 stuck problems",
    takeaway:
      "3/5 fixed, each stable after one reasoning round. The two survivors (widow, Monty Hall) are anchoring: the model confirms its own wrong answer even though it solves both one-shot.",
    results: (expHybrid as any).results,
  },
  {
    title: "De-anchoring — previous attempt framed as a student's",
    config: "same as Escalation B, but feedback presented as another student's answer",
    takeaway:
      "Identical 3/5 — the anchor is the mere presence of a proposed answer, not self-attribution. On instant wrong convergence, a fresh no-feedback reasoning pass beats any feedback variant.",
    results: (expStudent as any).results,
  },
  {
    title: '"Are you sure?" challenge — e4b',
    config: "one growing conversation · 2 doubt rounds appended · direct answers",
    takeaway:
      "Completely inert: all 22 answers identical through both rounds (15/22 stays 15/22). Doubt without a re-derivation procedure loses to the anchor of the model's own visible answer — at 3× the token cost.",
    results: (challengeE4b as any).results,
  },
  {
    title: '"Are you sure?" challenge — e2b',
    config: "one growing conversation · 2 doubt rounds appended · direct answers",
    takeaway:
      "Sycophantic: 11/22 drops to 10/22 — it abandoned a correct answer (Alice's sisters 5 → 4), churned two wrong answers into different wrong answers, and fixed nothing. Compare the fresh-context loop: fixed 2–5, broke zero.",
    results: (challengeE2b as any).results,
  },
];

function pct(pass: number, total: number) {
  return `${pass}/${total}`;
}

export default function ResultsView() {
  return (
    <>
      <div className="view-header">
        <span className="view-title">Results</span>
        <span className="view-desc">
          Recorded findings for <b>gemma4:latest</b> (8B Q4, temp 0, thinking off) — June 11, 2026.
          This tab works without Ollama; reproduce any run with the scripts in the repo root.
        </span>
      </div>
      <div className="view-body">
        <div className="results-pipeline">
          <div className="pipe-step">
            <div className="pipe-num">15<span>/22</span></div>
            <div className="pipe-label">one-shot, direct answers</div>
          </div>
          <div className="pipe-arrow">→</div>
          <div className="pipe-step">
            <div className="pipe-num">17<span>/22</span></div>
            <div className="pipe-label">+ refinement loop</div>
          </div>
          <div className="pipe-arrow">→</div>
          <div className="pipe-step accent">
            <div className="pipe-num">20<span>/22</span></div>
            <div className="pipe-label">+ reasoning in revisions</div>
          </div>
          <div className="pipe-arrow muted">vs</div>
          <div className="pipe-step muted">
            <div className="pipe-num">21<span>/22</span></div>
            <div className="pipe-label">free-form every time (slow)</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">One-shot probes</div>
          <div className="probe-grid">
            {PROBES.map((p) => {
              const pass = p.data.filter((r) => r.pass).length;
              return (
                <div key={p.title} className="probe-tile">
                  <div className="probe-score">{pct(pass, p.data.length)}</div>
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

        {EXPERIMENTS.map((exp) => (
          <div className="card" style={{ marginBottom: 16 }} key={exp.title}>
            <div className="card-title">{exp.title}</div>
            <div className="exp-config">{exp.config}</div>
            <table className="bench" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Problem</th>
                  <th>Answer trail (attempt 0 → revisions)</th>
                  <th>Outcome</th>
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
                    </tr>
                  ))}
              </tbody>
            </table>
            <div className="exp-takeaway">{exp.takeaway}</div>
          </div>
        ))}

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Model-size frontier — e2b vs e4b (the on-device question)</div>
          <div className="exp-config">
            classic battery · same checkers · decode speed measured with identical short prompts
          </div>
          <table className="bench" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Model</th>
                <th>Free-form</th>
                <th>Direct</th>
                <th>Direct + loop</th>
                <th>Decode speed</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>gemma4:e4b (= :latest)</td>
                <td>21/22</td>
                <td>15/22</td>
                <td>17/22 (20/22 with escalation)</td>
                <td>12.9 tok/s</td>
              </tr>
              <tr>
                <td>gemma4:e2b</td>
                <td>15/22</td>
                <td>11/22</td>
                <td>16/22 *</td>
                <td>24.1 tok/s (1.9×)</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 12 }}>
            {(compareE2b as any).summary[0].refined.map((r: any) => {
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
            e2b + refinement loop (16/22) ≈ e4b one-shot direct (15/22) at 1.9× the decode speed — iteration partly
            substitutes for parameters. But free-form reasoning HURTS e2b on trick questions (15/22 vs 21/22 for
            e4b): it talks itself out of memorized correct answers. * The recorded run counted e2b's
            "lpopillol" as a pass for spell-backwards; the substring checker has since been fixed (whole-word
            match) and the corrected pipeline score is 16/22.
          </div>
        </div>

        <div className="card">
          <div className="card-title">Reproduce</div>
          <pre className="repro-block">{`# from the repo root (Ollama running, gemma4 pulled)
node probe.mjs  --style free   --out probe-results.json
node probe.mjs  --style direct --out probe-direct-results.json
node probe2.mjs --style free   --out probe2-results.json

# the refinement loop (baseline vs converged vs final policies)
node experiment.mjs --style direct --rounds 4 --feedback full --set classic

# escalations on the 5 stuck problems
node experiment.mjs --style direct --revisionTemp 0.8 --rounds 6 \\
  --only count-r-strawberry,arithmetic-chain,widow-marry,count-words,monty-random-host
node experiment.mjs --style direct --revisionStyle free --rounds 3 \\
  --only count-r-strawberry,arithmetic-chain,widow-marry,count-words,monty-random-host

# de-anchoring variant + cross-model frontier
node experiment.mjs --style direct --revisionStyle free --framing student --rounds 3 \\
  --only count-r-strawberry,arithmetic-chain,widow-marry,count-words,monty-random-host
node compare.mjs --models gemma4:e2b,gemma4:e4b --rounds 3

# "are you sure?" challenge (growing conversation, doubt rounds)
node experiment.mjs --mode challenge --style direct --rounds 2 --model gemma4:e4b`}</pre>
        </div>
      </div>
    </>
  );
}
