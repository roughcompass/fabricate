"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { IMPACTS, IMPACT_LABELS, type AuditResult } from "@/components/toolbar/accessibility/audit";
import styles from "@/components/toolbar/accessibility/accessibility.module.css";
import { useTargetDocument } from "../target-document";
import { ToolPanel } from "../tool-panel";
import { type Found, useAudit } from "./audit-state";

/**
 * The Accessibility tool over a running application: runs axe-core in the
 * application's page, then reports totals by impact and violations grouped by
 * rule, each affected element by its selector and the route it was found on.
 */
export function AccessibilityPanel() {
  const audit = useAudit();
  const target = useTargetDocument();
  const { report } = audit;
  const count = report?.results.reduce((sum, result) => sum + result.nodes.length, 0) ?? 0;

  /** Scrolls a result's first element on the page into view; the overlay highlights all of them. */
  const reveal = (result: AuditResult<Found>) => {
    const element = result.nodes.map((node) => (node.selector && target.document ? target.document.querySelector(node.selector) : null)).find(Boolean);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <ToolPanel title="Accessibility" description="An automated WCAG 2 A and AA audit of what is on the page now." wide>
      <div className={styles.runRow}>
        <Button variant="primary" icon="play" onClick={audit.run} disabled={audit.running}>
          {report ? "Run audit again" : "Run audit"}
        </Button>
        <p className={styles.status} role="status">
          {audit.running ? "Auditing the page…" : audit.failed ? "The audit could not run. Try again." : report ? (count === 0 ? "No violations found." : `${count} ${count === 1 ? "element has" : "elements have"} violations.`) : "The audit checks the running application, not the toolbar."}
        </p>
      </div>

      {report && audit.stale && (
        <p className={styles.stale} data-audit-stale="">
          The page changed after this audit, so these results may be out of date. Run the audit again to refresh them.
        </p>
      )}

      {report && (
        <>
          <dl className={styles.totals} aria-label="Violations by impact">
            {IMPACTS.map((impact) => (
              <div key={impact} className={styles.total} data-impact={impact}>
                <dt>{IMPACT_LABELS[impact]}</dt>
                <dd>{report.totals[impact]}</dd>
              </div>
            ))}
          </dl>
          {report.results.length > 0 && (
            <Checkbox id="audit-outlines" label="Show outlines on the page" description="Outline each affected element, labeled with its result number." checked={audit.showOutlines} onChange={(event) => audit.setShowOutlines(event.currentTarget.checked)} />
          )}
          <ol className={styles.results} aria-label="Violations">
            {report.results.map((result) => (
              <li key={result.rule} className={styles.result} data-audit-result={result.number} data-rule={result.rule}>
                <button
                  type="button"
                  className={styles.resultButton}
                  aria-pressed={audit.selected === result.number}
                  onClick={() => {
                    audit.select(result.number);
                    audit.setShowOutlines(true);
                    reveal(result);
                  }}
                >
                  <span className={styles.number} data-impact={result.impact} aria-hidden="true">
                    {result.number}
                  </span>
                  <span className={styles.resultText}>
                    <span className={styles.resultTitle}>{result.title}</span>
                    <span className={styles.resultMeta}>{`${IMPACT_LABELS[result.impact]} · ${result.nodes.length} ${result.nodes.length === 1 ? "element" : "elements"} · ${result.rule}`}</span>
                  </span>
                </button>
                <p className={styles.description}>{result.description}</p>
                {result.guidance.length > 0 && (
                  <ul className={styles.guidance} aria-label={`How to fix result ${result.number}`}>
                    {result.guidance.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
                <ul className={styles.nodes} aria-label={`Elements for result ${result.number}`}>
                  {result.nodes.map((node, index) => (
                    <li key={`${node.selector}-${index}`} className={styles.node} data-audit-node="" data-selector={node.selector} data-route={node.route}>
                      <span className={styles.attribution}>
                        <code>{node.selector}</code>
                        {` on ${node.route}`}
                      </span>
                      <code className={styles.html}>{node.html}</code>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </>
      )}
    </ToolPanel>
  );
}
