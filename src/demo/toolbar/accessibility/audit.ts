/**
 * The accessibility audit's report (template-demo/toolbar spec): axe-core's
 * violations summarized by impact and grouped by rule, with each affected
 * element attributed: to the microfrontend and version that rendered it in
 * the demo runtime, and to the route it was found on in a running
 * application. No React or browser dependencies, so the summary can be
 * tested directly.
 */

/** The automated rules the audit runs: WCAG 2 A and AA. */
export const AUDIT_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

export const IMPACTS = ["critical", "serious", "moderate", "minor"] as const;
export type Impact = (typeof IMPACTS)[number];

export const IMPACT_LABELS: Record<Impact, string> = { critical: "Critical", serious: "Serious", moderate: "Moderate", minor: "Minor" };

/** The parts of an axe-core violation the report uses. */
export interface RawViolation {
  readonly id: string;
  readonly impact?: string | null;
  readonly help: string;
  readonly description: string;
  readonly nodes: readonly { readonly target: readonly unknown[]; readonly html: string; readonly failureSummary?: string; readonly impact?: string | null }[];
}

export interface Attribution {
  readonly member: string;
  readonly memberName: string;
  readonly version: string;
}

/** An affected element, with whatever the report attributes it to. */
type AuditNode<A extends object> = A & {
  /** A selector that finds the element again, for outlines and scrolling. */
  readonly selector: string;
  readonly html: string;
};

export interface AuditResult<A extends object = Attribution> {
  /** Numbered from 1, in report order; outlines carry the same number. */
  readonly number: number;
  readonly rule: string;
  readonly impact: Impact;
  readonly title: string;
  readonly description: string;
  /** How to fix it, from the failing checks, without repeats. */
  readonly guidance: readonly string[];
  readonly nodes: readonly AuditNode<A>[];
}

export interface AuditReport<A extends object = Attribution> {
  readonly totals: Record<Impact, number>;
  readonly results: readonly AuditResult<A>[];
}

function impactOf(value: string | null | undefined): Impact {
  return (IMPACTS as readonly string[]).includes(value ?? "") ? (value as Impact) : "minor";
}

/** Strips axe's "Fix any of the following:" headers and splits the remaining checks. */
export function guidanceLines(summary: string | undefined): string[] {
  return (summary ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^Fix (any|all) of the following:?$/i.test(line));
}

/**
 * Turns axe violations into the report: results ordered by impact, then by
 * rule, each node attributed with `attribute` (which looks the element up on
 * the page). Totals count affected elements by impact.
 */
export function summarize<A extends object = Attribution>(violations: readonly RawViolation[], attribute: (selector: string) => A): AuditReport<A> {
  const totals: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const ordered = [...violations].sort((left, right) => IMPACTS.indexOf(impactOf(left.impact)) - IMPACTS.indexOf(impactOf(right.impact)) || left.id.localeCompare(right.id));
  const results = ordered.map((violation, index): AuditResult<A> => {
    const impact = impactOf(violation.impact);
    totals[impact] += violation.nodes.length;
    const nodes = violation.nodes.map((node): AuditNode<A> => {
      const selector = typeof node.target[0] === "string" ? node.target[0] : "";
      return { selector, html: node.html, ...attribute(selector) };
    });
    return {
      number: index + 1,
      rule: violation.id,
      impact,
      title: violation.help,
      description: violation.description,
      guidance: [...new Set(violation.nodes.flatMap((node) => guidanceLines(node.failureSummary)))],
      nodes,
    };
  });
  return { totals, results };
}
