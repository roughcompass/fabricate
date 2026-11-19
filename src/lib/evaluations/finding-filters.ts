import type { JsonObject } from "@repo-facts/contract";
import type { Executor } from "@/lib/db/client";
import { type SearchParams, oneOf } from "@/lib/web/query";
import { type Finding, OUTCOMES, SEVERITIES, findingDocument, findingsOf } from "./evaluation-records";

/** A Finding with its document. */
export interface FindingRow {
  finding: Finding;
  document: JsonObject;
}

/** What the Evaluation page's filters keep: a pinned Release by position, an outcome, a severity, a Control, and a subject. */
export interface FindingFilters {
  release?: string;
  outcome?: (typeof OUTCOMES)[number];
  severity?: (typeof SEVERITIES)[number];
  control?: string;
  subject?: string;
}

export interface FilteredFindings {
  all: FindingRow[];
  /** The Controls and subjects the Findings cover, by key, with their titles and names in alphabetical order. */
  controls: [key: string, title: string][];
  subjects: [key: string, name: string][];
  filters: FindingFilters;
  filtered: boolean;
  shown: FindingRow[];
}

/**
 * An Evaluation's Findings, what they cover, and those the filters in +query+
 * keep. A filter value the Evaluation doesn't have is ignored. +releases+ are
 * the Evaluation's pinned Releases.
 */
export function filterFindings(db: Executor, evaluationId: number, releases: readonly { id: number; position: number }[], query: SearchParams): FilteredFindings {
  const all = findingsOf(db, evaluationId).map((finding) => ({ finding, document: findingDocument(finding) }));
  const byTitle = (entries: [string, string][]) => [...new Map(entries).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const controls = byTitle(all.map(({ finding, document }) => [finding.controlKey, String((document.control as JsonObject).title)]));
  const subjects = byTitle(all.map(({ finding, document }) => [finding.subjectKey, String((document.subject as JsonObject).name)]));
  const filters: FindingFilters = {
    release: oneOf(query, "release", releases.map(({ position }) => String(position))),
    outcome: oneOf(query, "outcome", OUTCOMES),
    severity: oneOf(query, "severity", SEVERITIES),
    control: oneOf(query, "control", controls.map(([key]) => key)),
    subject: oneOf(query, "subject", subjects.map(([key]) => key)),
  };
  const releaseId = filters.release && releases.find(({ position }) => String(position) === filters.release)?.id;
  const shown = all.filter(
    ({ finding }) =>
      (!releaseId || finding.evaluationReleaseId === releaseId) &&
      (!filters.outcome || finding.outcome === filters.outcome) &&
      (!filters.severity || finding.severity === filters.severity) &&
      (!filters.control || finding.controlKey === filters.control) &&
      (!filters.subject || finding.subjectKey === filters.subject),
  );
  return { all, controls, subjects, filters, filtered: Object.values(filters).some(Boolean), shown };
}
