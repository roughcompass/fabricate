import { sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import type { Conclusion } from "./summary";

/**
 * Each Assessment's standing by the conclusion of its latest completed
 * Evaluation (home spec, fleet summary; page-patterns spec, list filters).
 * Home counts these and the Assessments list filters by them, so both read
 * this one query: "none" stands for an Assessment with no completed
 * Evaluation, shown as Not evaluated.
 */

export const CONCLUSION_FILTERS = ["gaps", "undetermined", "conforms", "not_applicable", "none"] as const satisfies readonly (Conclusion | "none")[];
export type ConclusionFilter = (typeof CONCLUSION_FILTERS)[number];

export function isConclusionFilter(value: unknown): value is ConclusionFilter {
  return typeof value === "string" && (CONCLUSION_FILTERS as readonly string[]).includes(value);
}

/** The status a conclusion filter shows with: Not evaluated for an Assessment with no completed Evaluation. */
export function conclusionState(filter: ConclusionFilter): string {
  return filter === "none" ? "not_evaluated" : filter;
}

export interface LatestConclusion {
  /** The latest completed Evaluation and its sequence number, or null when none has completed. */
  evaluation: { id: number; publicId: string; number: number } | null;
  conclusion: ConclusionFilter;
}

/**
 * The latest completed Evaluation's conclusion for every Assessment the
 * operator created, by the model Initiative's id. The Repository profiling
 * initiative isn't included. With +at+, as things stood then: the
 * Assessments created by then, and the Evaluations completed by then. One
 * query, whatever the number of Assessments.
 */
export function latestConclusions(db: Executor, options: { at?: Date } = {}): Map<number, LatestConclusion> {
  const at = options.at?.getTime();
  const rows = db.all<{ initiative_id: number; evaluation_id: number | null; public_id: string | null; number: number | null; conclusion: string | null }>(sql`
    with numbered as (
      select e.id, e.public_id, e.initiative_id, e.state, e.summary, coalesce(e.finished_at, e.created_at) as completed_at,
        row_number() over (partition by e.initiative_id order by e.id) as number
      from evaluations e
    ),
    latest as (
      select numbered.*, row_number() over (partition by initiative_id order by id desc) as recency
      from numbered
      where state = 'complete'${at === undefined ? sql`` : sql` and completed_at <= ${at}`}
    )
    select i.id as initiative_id, l.id as evaluation_id, l.public_id, l.number,
      json_extract(l.summary, '$.combined.conclusion') as conclusion
    from initiatives i
    left join latest l on l.initiative_id = i.id and l.recency = 1
    where i.profiling = 0${at === undefined ? sql`` : sql` and i.created_at <= ${at}`}`);
  return new Map(
    rows.map((row) => [
      row.initiative_id,
      {
        evaluation: row.evaluation_id === null ? null : { id: row.evaluation_id, publicId: row.public_id!, number: row.number! },
        // A completed Evaluation always has a summary; an unreadable one counts as not evaluated rather than guessing.
        conclusion: row.evaluation_id !== null && isConclusionFilter(row.conclusion) && row.conclusion !== "none" ? row.conclusion : "none",
      },
    ]),
  );
}

/** How many Assessments stand at each conclusion. */
export function conclusionCounts(conclusions: ReadonlyMap<number, LatestConclusion>): Record<ConclusionFilter, number> {
  const counts = Object.fromEntries(CONCLUSION_FILTERS.map((filter) => [filter, 0])) as Record<ConclusionFilter, number>;
  for (const { conclusion } of conclusions.values()) counts[conclusion]++;
  return counts;
}
