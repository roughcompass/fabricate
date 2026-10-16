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

export interface LatestConclusion {
  /** The latest completed Evaluation and its sequence number, or null when none has completed. */
  evaluation: { id: number; publicId: string; number: number } | null;
  conclusion: ConclusionFilter;
}

/**
 * The latest completed Evaluation's conclusion for every Assessment the
 * operator created, or for every Assessment created for a claim, by the
 * model Initiative's id. The Salt Patterns initiative's template Assessments
 * and the DE Web initiative's are neither. One query, whatever the number of Assessments.
 */
export function latestConclusions(db: Executor, options: { systemOwned?: boolean } = {}): Map<number, LatestConclusion> {
  const systemOwned = options.systemOwned ?? false;
  const rows = db.all<{ initiative_id: number; evaluation_id: number | null; public_id: string | null; number: number | null; conclusion: string | null }>(sql`
    with numbered as (
      select e.id, e.public_id, e.initiative_id, e.state, e.summary,
        row_number() over (partition by e.initiative_id order by e.id) as number
      from evaluations e
    ),
    latest as (
      select numbered.*, row_number() over (partition by initiative_id order by id desc) as recency
      from numbered
      where state = 'complete'
    )
    select i.id as initiative_id, l.id as evaluation_id, l.public_id, l.number,
      json_extract(l.summary, '$.combined.conclusion') as conclusion
    from initiatives i
    left join latest l on l.initiative_id = i.id and l.recency = 1
    where (i.claim_repository_source_id is not null) = ${systemOwned ? 1 : 0} and i.system_owned = 0 and i.de_web = 0`);
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
