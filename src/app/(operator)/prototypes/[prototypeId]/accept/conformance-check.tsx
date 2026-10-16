"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type Conformance, confirmable } from "@/lib/prototypes/conformance-result";
import styles from "./accept.module.css";

const POLL_MS = 1_500;
const SALT_PATTERNS = "/assessments/ini_saltpatterns0000";

interface ConformanceCheckProps {
  versionId: string;
  /** The Run checking the version, or null when none started because no Release is selected. */
  run: string | null;
  /** Starts a new Run of the version and returns its id. */
  recheck: () => Promise<string | null>;
  /** Reports the Run the confirmation submits and whether it lets Accept be confirmed. */
  onResult: (run: string | null, confirmable: boolean) => void;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * The confirmation's check against the Releases selected on the Salt Patterns
 * initiative (template-conformance spec): it polls until the version's
 * Evaluation finishes, then lists each Release's results and every Finding
 * that blocks acceptance, or says why the version isn't evaluated.
 */
export function ConformanceCheck({ versionId, run, recheck, onResult }: ConformanceCheckProps) {
  const [current, setCurrent] = useState(run);
  const [result, setResult] = useState<Conformance | null>(null);
  const [restarting, startRestart] = useTransition();
  const settled = result !== null && result.status !== "running";

  useEffect(() => {
    if (settled) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/prototypes/conformance?${new URLSearchParams({ version: versionId, ...(current ? { run: current } : {}) })}`, { cache: "no-store" });
        if (active && response.ok) setResult((await response.json()) as Conformance);
      } catch {
        // A missed poll is retried on the next tick.
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [versionId, current, settled]);

  useEffect(() => onResult(current, result !== null && confirmable(result)), [current, result, onResult]);

  const again = (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={restarting}
      onClick={() =>
        startRestart(async () => {
          const next = await recheck();
          setResult(null);
          setCurrent(next);
        })
      }
    >
      {restarting ? "Starting" : "Check again"}
    </Button>
  );

  if (result === null || result.status === "running") {
    if (result?.status === "running" && result.stalled) {
      return (
        <div data-conformance="stalled">
          <Alert tone="warning" title="The worker isn't running" actions={again} live>
            The check of this version is waiting for DE FabLab&apos;s worker. Start it, for example with <code>npm run dev</code>, then check again.
          </Alert>
        </div>
      );
    }
    return (
      <p className={styles.muted} role="status" data-conformance="running">
        {result?.status === "running" && result.stage === "evaluating" ? "Evaluating against the Releases selected on Salt Patterns…" : "Assessing the exported project…"}
      </p>
    );
  }

  switch (result.status) {
    case "not_evaluated":
      return (
        <div data-conformance="not-evaluated">
          <Alert tone="info" title="Not evaluated: no Release is selected">
            The Salt Patterns initiative selects no Standard Release, so this version is accepted on its checks and accessibility alone, and its template shows Not evaluated. <Link href="/standards/new">Start from a Salt starter</Link> in the Standard Library, publish it, then{" "}
            <Link href={`${SALT_PATTERNS}/edit`}>select it on Salt Patterns</Link>.
          </Alert>
        </div>
      );
    case "failed":
      return (
        <div data-conformance="failed">
          <Alert tone="error" title="The check didn't finish" actions={again} live>
            {result.reason}
          </Alert>
        </div>
      );
    case "unavailable":
      return (
        <div data-conformance="unavailable">
          <Alert tone="warning" title="The check's results can't be found" actions={again} live>
            Without them this version can&apos;t be shown to meet the Releases selected on Salt Patterns.
          </Alert>
        </div>
      );
    case "evaluated":
      return (
        <div className={styles.conformance} data-conformance={result.blocking.length ? "blocked" : "passed"}>
          <ul className={styles.releases} aria-label="Releases checked">
            {result.releases.map((release) => (
              <li key={release.publicId}>
                <strong>{release.label}</strong>
                {`: ${plural(release.counts.meets, "Meets", "Meets")}, ${plural(release.counts.gap, "Gap")}, ${release.counts.indeterminate} Indeterminate, ${release.counts.not_applicable} Not applicable`}
              </li>
            ))}
          </ul>
          {result.blocking.length ? (
            <Alert tone="error" title={`${plural(result.blocking.length, "Finding")} block acceptance`} live>
              <ul className={styles.blocking} aria-label="Findings that block acceptance">
                {result.blocking.map((finding) => (
                  <li key={finding.href} data-blocking={finding.outcome}>
                    <Link href={finding.href}>{`${finding.release} · ${finding.control}`}</Link>
                    {`: ${finding.outcome === "gap" ? "Gap" : "Indeterminate"}.`}
                    {finding.observed && ` ${finding.observed}.`}
                    {finding.causes.length > 0 && ` ${finding.causes.join(" ")}`}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert tone="success" title="Meets every selected Release">
              <Link href={`/evaluations/${result.evaluationId}`}>View the Evaluation</Link>
            </Alert>
          )}
        </div>
      );
  }
}
