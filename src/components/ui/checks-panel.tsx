import Link from "next/link";
import { formatFit } from "@/lib/prototypes/summary";
import { CRITERIA, type Attempt, type Audit, type FitReview, type GateName, type GateResult, type RenderError, type Score } from "@/lib/prototypes/types";
import { Status } from "./status";
import styles from "./checks-panel.module.css";

const GATE_LABELS: Record<GateName, string> = { typecheck: "Typecheck", "salt-only": "Salt only", "salt-usage": "Salt usage", build: "Build" };
const GATE_DESCRIPTIONS: Record<GateName, string> = {
  typecheck: "Against the Salt and React types the preview renders with.",
  "salt-only": "Imports and styling come only from Salt.",
  "salt-usage": "Salt's own usage validator.",
  build: "The code compiles for the preview.",
};
const IMPACT_ORDER = ["critical", "serious", "moderate", "minor"] as const;

const scoreText = (score: Score) => (score === "unknown" ? "Unknown" : `${score} of 5`);

interface ChecksPanelProps {
  readonly gates: readonly GateResult[];
  readonly attempts: readonly Attempt[];
  readonly firstPass: readonly GateResult[] | null;
  readonly audit: Audit | null;
  readonly renderError: RenderError | null;
  readonly fit: FitReview | null;
  /** The preview's address for a violation, so selecting one highlights its element there. */
  readonly highlightHref?: (index: number) => string;
}

/**
 * A version's evidence (quality-checks spec, "The Checks panel shows all
 * evidence for a version"): each gate's result, the repairs, the first-pass
 * result, warnings, the accessibility audit, and the persona-fit review,
 * labeled as an advisory AI review. Gate results come from DE FabLab, never
 * from the model.
 */
export function ChecksPanel({ gates, attempts, firstPass, audit, renderError, fit, highlightHref }: ChecksPanelProps) {
  const repairs = Math.max(0, attempts.length - 1);
  const firstFailures = (firstPass ?? []).filter((gate) => gate.status === "failed");
  const warnings = gates.flatMap((gate) => gate.warnings.map((warning) => ({ gate: gate.gate, warning })));
  const violations = [...(audit?.violations ?? [])].map((violation, index) => ({ violation, index })).sort((a, b) => IMPACT_ORDER.indexOf(a.violation.impact) - IMPACT_ORDER.indexOf(b.violation.impact));

  return (
    <div className={styles.panel} data-checks-panel="">
      <section className={styles.section} aria-labelledby="checks-gates">
        <h2 id="checks-gates" className={styles.heading}>
          Gates
        </h2>
        <ul className={styles.gates}>
          {gates.map((gate) => (
            <li key={gate.gate} className={styles.gate} data-gate={gate.gate}>
              <div className={styles.gateHead}>
                <span className={styles.gateName}>{GATE_LABELS[gate.gate]}</span>
                <Status state={gate.status === "passed" ? "pass" : gate.status === "failed" ? "fail" : "not_evaluated"} label={gate.status === "not-run" ? "Not run" : undefined} size="sm" />
              </div>
              <p className={styles.muted}>{GATE_DESCRIPTIONS[gate.gate]}</p>
              {gate.issues.length > 0 && (
                <ul className={styles.issues}>
                  {gate.issues.map((issue, index) => (
                    <li key={index}>{`${issue.line ? `Line ${issue.line}: ` : ""}${issue.message}`}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <p className={styles.attempts} data-repairs={repairs}>
          {attempts.length === 0 ? "Not checked yet." : repairs === 0 ? "Passed on the first attempt." : `${repairs === 1 ? "One repair" : `${repairs} repairs`}: the first attempt failed ${firstFailures.map((gate) => GATE_LABELS[gate.gate].toLowerCase()).join(" and ") || "a check"}, and DE FabLab sent the failures back to the generator.`}
        </p>
        {firstFailures.length > 0 && (
          <details className={styles.details} data-first-pass="">
            <summary>First-pass result</summary>
            <ul className={styles.issues}>
              {firstFailures.flatMap((gate) => gate.issues.map((issue, index) => <li key={`${gate.gate}-${index}`}>{`${GATE_LABELS[gate.gate]}${issue.line ? `, line ${issue.line}` : ""}: ${issue.message}`}</li>))}
            </ul>
          </details>
        )}
      </section>

      {warnings.length > 0 && (
        <section className={styles.section} aria-labelledby="checks-warnings">
          <h2 id="checks-warnings" className={styles.heading}>
            Warnings
          </h2>
          <ul className={styles.list}>
            {warnings.map(({ gate, warning }, index) => (
              <li key={index} data-warning={warning.code}>
                <Status state="warning" size="sm" label={GATE_LABELS[gate]} /> {warning.message}
                {warning.fix && <span className={styles.muted}>{` ${warning.fix}`}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.section} aria-labelledby="checks-render">
        <h2 id="checks-render" className={styles.heading}>
          Accessibility audit
        </h2>
        <p className={styles.muted}>An automated audit of the first render at desktop width in light mode. It finds about half of accessibility issues; keyboard flows still need a manual review.</p>
        {renderError ? (
          <p className={styles.error} data-render-error="">{`Failed render: ${renderError.message}`}</p>
        ) : !audit ? (
          <p className={styles.muted}>Runs the first time the version renders.</p>
        ) : violations.length === 0 ? (
          <p data-audit="clean">No accessibility issues found.</p>
        ) : (
          <ul className={styles.list} data-audit="violations">
            {violations.map(({ violation, index }) => (
              <li key={index} data-violation={violation.rule}>
                <span className={styles.impact} data-impact={violation.impact}>
                  {violation.impact}
                </span>{" "}
                {`${violation.help} (${violation.rule})`}
                {violation.targets[0] && <code className={styles.target}>{violation.targets[0]}</code>}
                {highlightHref && (
                  <Link href={highlightHref(index)} className={styles.link}>
                    Show in preview
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="checks-fit">
        <h2 id="checks-fit" className={styles.heading}>
          Persona fit
        </h2>
        {!fit ? (
          <p className={styles.muted}>The review runs after the gates pass.</p>
        ) : fit.status === "not-applicable" ? (
          <p data-fit="not-applicable">Not applicable: the version was generated without a persona.</p>
        ) : fit.status === "failed" ? (
          <p className={styles.error}>{`The review didn't run: ${fit.error ?? "unknown error"}.`}</p>
        ) : (
          <>
            <p className={styles.muted} data-fit-model={fit.model}>{`AI review by ${fit.model}, from the code alone. It is advisory, never a gate.${fit.average === null ? "" : ` Average fit ${formatFit(fit.average)} of 5, over every known score.`}`}</p>
            {fit.personas.map((persona) => (
              <div key={persona.personaId} className={styles.persona} data-fit-persona={persona.personaId}>
                <h3 className={styles.subheading}>{persona.personaName}</h3>
                <table className={styles.scores}>
                  <tbody>
                    {CRITERIA.map((criterion) => (
                      <tr key={criterion.id}>
                        <th scope="row">{criterion.label}</th>
                        <td data-score={persona.criteria[criterion.id].score}>{scoreText(persona.criteria[criterion.id].score)}</td>
                        <td className={styles.muted}>{persona.criteria[criterion.id].reason}</td>
                      </tr>
                    ))}
                    {persona.checks.map((check) => (
                      <tr key={check.check} data-intent-check="">
                        <th scope="row">{check.check}</th>
                        <td data-score={check.score}>{scoreText(check.score)}</td>
                        <td className={styles.muted}>{check.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {persona.strengths.length > 0 && (
                  <p className={styles.findings}>
                    <strong>Strengths: </strong>
                    {persona.strengths.map((finding) => `${finding.text}${finding.element ? ` (${finding.element})` : ""}`).join(" ")}
                  </p>
                )}
                {persona.gaps.length > 0 && (
                  <p className={styles.findings}>
                    <strong>Gaps: </strong>
                    {persona.gaps.map((finding) => `${finding.text}${finding.element ? ` (${finding.element})` : ""}`).join(" ")}
                  </p>
                )}
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
