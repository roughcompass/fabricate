import type { Audit, FitReview, GateResult } from "./types";

/**
 * A version's one-line summary (quality-checks spec, "The Checks panel shows
 * all evidence for a version"): whether every gate passed, how many
 * accessibility violations it has, and its average fit.
 */

export interface SummaryInput {
  readonly status: "pending" | "ready" | "failed";
  readonly gatesPassed: boolean;
  readonly gates?: readonly GateResult[];
  readonly audit: Audit | null;
  readonly fit: FitReview | null;
  readonly renderError?: unknown;
}

export interface CheckSummary {
  readonly checks: "passed" | "failed" | "pending";
  /** Null until the version's first render has been audited. */
  readonly violations: number | null;
  readonly fit: number | null;
  readonly fitStatus: FitReview["status"] | "pending";
  readonly renderFailed: boolean;
  readonly text: string;
}

/** A fit rounded to one decimal, as it is shown everywhere. */
export function formatFit(value: number): string {
  return value.toFixed(1);
}

export function checkSummary(version: SummaryInput): CheckSummary {
  const checks = version.status === "pending" ? "pending" : version.gatesPassed ? "passed" : "failed";
  const violations = version.audit ? version.audit.violations.length : null;
  const fit = version.fit?.average ?? null;
  const fitStatus = version.fit?.status ?? "pending";
  const renderFailed = Boolean(version.renderError);
  const parts = [checks === "passed" ? "Checks passed" : checks === "failed" ? "Checks failed" : "Checks running"];
  if (renderFailed) parts.push("render failed");
  else if (violations === null) parts.push(checks === "passed" ? "accessibility audit pending" : "not audited");
  else parts.push(violations === 0 ? "no accessibility issues" : `${violations} accessibility ${violations === 1 ? "issue" : "issues"}`);
  if (fitStatus === "reviewed") parts.push(fit === null ? "fit unknown" : `fit ${formatFit(fit)}`);
  else if (fitStatus === "not-applicable") parts.push("fit not applicable");
  else if (fitStatus === "failed") parts.push("review failed");
  return { checks, violations, fit, fitStatus, renderFailed, text: parts.join(", ") };
}
