import { compareCodeUnits } from "@repo-facts/contract";

/*
 * Validation issues (design decision 8). Validation is a pure pass over one
 * candidate graph and the latest accepted observations. It reports every
 * issue it finds, each with a stable code, the field or relationship it's
 * about, and a sentence for people. A blocking issue stops submission and
 * readiness; a warning is shown and stops nothing.
 */

export type Severity = "blocking" | "warning";

export interface ValidationIssue {
  /** Stable and machine-readable, such as "route.collision". */
  code: string;
  severity: Severity;
  /** The field or relationship, such as "placements.1.route" or "children.0.contract". */
  location: string;
  message: string;
}

/** Collects issues in the order they're found. */
export class IssueList {
  readonly issues: ValidationIssue[] = [];

  block(code: string, location: string, message: string): void {
    this.issues.push({ code, severity: "blocking", location, message });
  }

  warn(code: string, location: string, message: string): void {
    this.issues.push({ code, severity: "warning", location, message });
  }

  add(...issues: readonly ValidationIssue[]): void {
    this.issues.push(...issues);
  }

  get blocking(): ValidationIssue[] {
    return this.issues.filter((issue) => issue.severity === "blocking");
  }
}

/** Issues in a stable order: by location, then code, so repeated validations read the same. */
export function sortIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort((a, b) => compareCodeUnits(a.location, b.location) || compareCodeUnits(a.code, b.code) || compareCodeUnits(a.message, b.message));
}

export function blockingCount(issues: readonly ValidationIssue[]): number {
  return issues.filter((issue) => issue.severity === "blocking").length;
}

/** The issues at one location, or under it: "placements.0" matches "placements.0.route". */
export function issuesAt(issues: readonly ValidationIssue[], location: string): ValidationIssue[] {
  return issues.filter((issue) => issue.location === location || issue.location.startsWith(`${location}.`));
}

/** Raised when an action is refused because of blocking issues; it carries all of them. */
export class BlockedError extends Error {
  override name = "BlockedError";

  constructor(
    message: string,
    readonly issues: readonly ValidationIssue[],
  ) {
    super(`${message}: ${issues.map((issue) => issue.message).join("; ")}`);
  }
}
