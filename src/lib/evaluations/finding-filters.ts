import { type SQL, and, asc, count, eq, or, sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { findings, runTargets } from "@/lib/db/schema";
import { type SearchParams, oneOf, pageNumber, searchTerm } from "@/lib/web/query";
import { OUTCOMES, SEVERITIES } from "./evaluation-records";
import { OUTCOME_ORDER } from "./summary";

/** Findings shown per Control, a page at a time (page-patterns spec, "Long lists are paged"). */
export const FINDINGS_PAGE_SIZE = 50;

type Outcome = (typeof OUTCOMES)[number];
type Severity = (typeof SEVERITIES)[number];

/** What the Evaluation page's filters keep: a pinned Release by position, an outcome, a severity, a Control, and text that the subject's name contains. */
export interface FindingFilters {
  release?: string;
  outcome?: Outcome;
  severity?: Severity;
  control?: string;
  subject?: string;
}

/** One Finding as its Control's table lists it. */
export interface FindingRow {
  publicId: string;
  subject: string;
  outcome: Outcome;
}

/** A Control's Findings in one Release that the filters keep: counted by outcome, with one page of them. */
export interface ControlFindings {
  key: string;
  title: string;
  severity: Severity;
  counts: [Outcome, number][];
  total: number;
  page: number;
  pages: number;
  rows: FindingRow[];
}

/** A pinned Release, by its position in the Evaluation, and the titles of its Controls by key. */
export interface FindingRelease {
  id: number;
  position: number;
  titles: ReadonlyMap<string, string>;
}

export interface FilteredFindings {
  /** Every Finding of the Evaluation. */
  total: number;
  /** The Findings the filters keep. */
  shown: number;
  /** The Controls the Findings cover, by key, with their titles, in alphabetical order. */
  controls: [key: string, title: string][];
  /** The names of the subjects the Findings cover, in alphabetical order, to suggest in the subject filter. */
  subjects: string[];
  filters: FindingFilters;
  filtered: boolean;
  /** Each Release's Controls with Findings the filters keep, in the order the Release lists them, by Release position. */
  byRelease: Map<number, ControlFindings[]>;
}

// A repository subject reads as the repository's name when the Run started; the Relationship Map is the one other subject.
const subjectName = sql<string>`coalesce(${runTargets.repositoryName}, 'Relationship Map')`;

/**
 * An Evaluation's Findings that the filters in +query+ keep, grouped by
 * Release and Control, with one page of each Control's: the database counts
 * and pages them, so a fleet's Evaluation reads only the rows it shows and
 * no Finding document. A filter value the Evaluation doesn't have is
 * ignored; the subject filter keeps subjects whose name contains its text,
 * or whose key it is. +page+ names the page each Control's Findings are on.
 */
export function filterFindings(db: Executor, evaluationId: number, releases: readonly FindingRelease[], query: SearchParams, page: (position: number, controlKey: string) => string | undefined): FilteredFindings {
  const titleOf = (key: string) => releases.map((release) => release.titles.get(key)).find(Boolean) ?? key;
  const keys = db.selectDistinct({ key: findings.controlKey }).from(findings).where(eq(findings.evaluationId, evaluationId)).all();
  const controls = keys.map(({ key }): [string, string] => [key, titleOf(key)]).sort((a, b) => a[1].localeCompare(b[1]));
  const subjects = db
    .selectDistinct({ name: subjectName })
    .from(findings)
    .leftJoin(runTargets, eq(runTargets.id, findings.runTargetId))
    .where(eq(findings.evaluationId, evaluationId))
    .all()
    .map(({ name }) => name)
    .sort((a, b) => a.localeCompare(b));
  const total = db.select({ value: count() }).from(findings).where(eq(findings.evaluationId, evaluationId)).get()?.value ?? 0;

  const filters: FindingFilters = {
    release: oneOf(query, "release", releases.map(({ position }) => String(position))),
    outcome: oneOf(query, "outcome", OUTCOMES),
    severity: oneOf(query, "severity", SEVERITIES),
    control: oneOf(query, "control", controls.map(([key]) => key)),
    subject: searchTerm(query, "subject") || undefined,
  };
  const release = filters.release === undefined ? undefined : releases.find(({ position }) => String(position) === filters.release);
  const conditions: (SQL | undefined)[] = [
    eq(findings.evaluationId, evaluationId),
    release && eq(findings.evaluationReleaseId, release.id),
    filters.outcome && eq(findings.outcome, filters.outcome),
    filters.severity && eq(findings.severity, filters.severity),
    filters.control ? eq(findings.controlKey, filters.control) : undefined,
    filters.subject ? or(sql`instr(lower(${subjectName}), ${filters.subject.toLowerCase()}) > 0`, eq(findings.subjectKey, filters.subject)) : undefined,
  ];
  const where = and(...conditions);

  // Each Control's counts by outcome, in each Release, in the order the Release lists its Controls.
  const groups = db
    .select({ releaseId: findings.evaluationReleaseId, key: findings.controlKey, outcome: findings.outcome, severity: sql<Severity>`min(${findings.severity})`, first: sql<number>`min(${findings.position})`, count: count() })
    .from(findings)
    .leftJoin(runTargets, eq(runTargets.id, findings.runTargetId))
    .where(where)
    .groupBy(findings.evaluationReleaseId, findings.controlKey, findings.outcome)
    .all();

  const byRelease = new Map<number, ControlFindings[]>();
  let shown = 0;
  for (const pinned of releases) {
    const own = groups.filter((group) => group.releaseId === pinned.id);
    const order = [...new Set(own.sort((a, b) => a.first - b.first).map((group) => group.key))];
    const list = order.map((key): ControlFindings => {
      const counted = own.filter((group) => group.key === key);
      const totalHere = counted.reduce((sum, group) => sum + group.count, 0);
      const { page: current, pages } = pageNumber(page(pinned.position, key), totalHere, FINDINGS_PAGE_SIZE);
      const rows = db
        .select({ publicId: findings.publicId, subject: subjectName, outcome: findings.outcome })
        .from(findings)
        .leftJoin(runTargets, eq(runTargets.id, findings.runTargetId))
        .where(and(where, eq(findings.evaluationReleaseId, pinned.id), eq(findings.controlKey, key)))
        .orderBy(asc(findings.position))
        .limit(FINDINGS_PAGE_SIZE)
        .offset((current - 1) * FINDINGS_PAGE_SIZE)
        .all();
      shown += totalHere;
      return {
        key,
        title: pinned.titles.get(key) ?? key,
        severity: counted[0]!.severity,
        counts: OUTCOME_ORDER.map((outcome): [Outcome, number] => [outcome, counted.find((group) => group.outcome === outcome)?.count ?? 0]).filter(([, number]) => number > 0),
        total: totalHere,
        page: current,
        pages,
        rows,
      };
    });
    if (list.length) byRelease.set(pinned.position, list);
  }
  return { total, shown, controls, subjects, filters, filtered: Object.values(filters).some(Boolean), byRelease };
}
