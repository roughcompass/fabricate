import { type JsonObject, type JsonValue, compareCodeUnits } from "@repo-facts/contract";
import type { Outcome } from "./controls";

/**
 * Evaluation summaries by Release, outcome, severity, and subject.
 *
 * Every outcome keeps its own count: Indeterminate and Not applicable are
 * never folded into Gap, and nothing is summarized as conforming while any
 * applicable result is a Gap or Indeterminate. Each Release is summarized
 * separately, and combined counts never merge or override Releases.
 */

export const OUTCOME_ORDER: readonly Outcome[] = ["gap", "indeterminate", "meets", "not_applicable"];
const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

export type Conclusion = "gaps" | "undetermined" | "conforms" | "not_applicable";

export interface SummaryFinding {
  releasePosition: number;
  outcome: Outcome;
  severity: string;
  subjectKey: string;
  subjectName: string;
  subjectType: string;
}

export interface SummaryRelease {
  position: number;
  public_id: string;
  standard: string;
  version: number;
  digest: string;
}

type Counts = Record<Outcome, number>;

const emptyCounts = (): Counts => ({ gap: 0, indeterminate: 0, meets: 0, not_applicable: 0 });

/** Gaps first; then any uncertainty; conformance only when every applicable result meets. */
export function conclusion(counts: Counts): Conclusion {
  if (counts.gap > 0) return "gaps";
  if (counts.indeterminate > 0) return "undetermined";
  if (counts.meets > 0) return "conforms";
  return "not_applicable";
}

function tally(findings: readonly SummaryFinding[]): { counts: Counts; severities: Record<string, Counts> } {
  const counts = emptyCounts();
  const severities: Record<string, Counts> = Object.fromEntries(SEVERITY_ORDER.map((severity) => [severity, emptyCounts()]));
  for (const finding of findings) {
    counts[finding.outcome]++;
    const bucket = severities[finding.severity];
    if (bucket) bucket[finding.outcome]++;
  }
  return { counts, severities };
}

export function summarize(input: { releases: readonly SummaryRelease[]; findings: readonly SummaryFinding[]; coverageGaps: number }): JsonObject {
  const releases = [...input.releases].sort((a, b) => a.position - b.position).map((release) => {
    const { counts, severities } = tally(input.findings.filter((finding) => finding.releasePosition === release.position));
    return { release: release.public_id, standard: release.standard, version: release.version, digest: release.digest, counts, severities, conclusion: conclusion(counts) };
  });
  const combined = tally(input.findings);

  const subjects = new Map<string, { key: string; name: string; type: string; findings: SummaryFinding[] }>();
  for (const finding of input.findings) {
    const entry = subjects.get(finding.subjectKey) ?? { key: finding.subjectKey, name: finding.subjectName, type: finding.subjectType, findings: [] };
    entry.findings.push(finding);
    subjects.set(finding.subjectKey, entry);
  }

  return {
    releases: releases as unknown as JsonValue[],
    combined: { counts: combined.counts, severities: combined.severities, conclusion: conclusion(combined.counts) },
    subjects: [...subjects.values()]
      .sort((a, b) => compareCodeUnits(a.type, b.type) || compareCodeUnits(a.name, b.name) || compareCodeUnits(a.key, b.key))
      .map((subject) => {
        const { counts } = tally(subject.findings);
        return { key: subject.key, name: subject.name, type: subject.type, counts, conclusion: conclusion(counts) };
      }),
    coverage_gaps: input.coverageGaps,
  };
}
