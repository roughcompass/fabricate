import { sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { type ConclusionFilter, conclusionCounts, latestConclusions } from "@/lib/evaluations/conclusions";
import { type FleetSummary, repositoryCount } from "./summary";

/*
 * Home's dashboard readers (home spec), each a fixed number of queries
 * whatever the size of the fleet: every figure as it stood seven days ago,
 * the Assessment trend by week, and the recent activity.
 */

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The figures as they stood at +cutoff+, to state each one's change since then. */
export interface FiguresThen {
  repositories: { total: number };
  assessments: { total: number; byConclusion: Record<ConclusionFilter, number> };
}

/** The figures as of +cutoff+, from when each record was created and when each Evaluation happened. */
export function figuresAt(db: Executor, cutoff: Date): FiguresThen {
  const conclusions = latestConclusions(db, { at: cutoff });
  return {
    repositories: { total: repositoryCount(db, { at: cutoff }) },
    assessments: { total: conclusions.size, byConclusion: conclusionCounts(conclusions) },
  };
}

/** How a figure changed over the week: "+2 this week", "−1 this week", or "No change this week". */
export function weekChange(now: number, then: number): string {
  const change = now - then;
  if (change === 0) return "No change this week";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)} this week`;
}

/** The Repositories and Assessments figures' changes over the last seven days. */
export function figureChanges(summary: FleetSummary, then: FiguresThen): { repositories: string; assessments: string } {
  return {
    repositories: weekChange(summary.repositories.total, then.repositories.total),
    assessments: weekChange(summary.assessments.total, then.assessments.total),
  };
}

const TREND_WEEKS = 8;

/** The conclusions the trend charts, in stacking order. */
const TREND_CONCLUSIONS = ["gaps", "undetermined", "conforms", "not_applicable"] as const satisfies readonly ConclusionFilter[];
type TrendConclusion = (typeof TREND_CONCLUSIONS)[number];

export interface TrendWeek {
  /** The week's first day. */
  start: Date;
  counts: Record<TrendConclusion, number>;
}

/** How many Evaluations completed with each conclusion, in each of the last +weeks+ seven-day windows, oldest first, the last ending at +now+. */
export function assessmentTrend(db: Executor, now: Date = new Date(), weeks = TREND_WEEKS): TrendWeek[] {
  const end = now.getTime();
  const start = end - weeks * WEEK_MS;
  const rows = db.all<{ week: number; conclusion: string | null; count: number }>(sql`
    select cast((coalesce(e.finished_at, e.created_at) - ${start}) / ${WEEK_MS} as integer) as week,
      json_extract(e.summary, '$.combined.conclusion') as conclusion, count(*) as count
    from evaluations e
    where e.state = 'complete' and coalesce(e.finished_at, e.created_at) > ${start} and coalesce(e.finished_at, e.created_at) <= ${end}
    group by week, conclusion`);
  const result: TrendWeek[] = Array.from({ length: weeks }, (_, index) => ({ start: new Date(start + index * WEEK_MS), counts: { gaps: 0, undetermined: 0, conforms: 0, not_applicable: 0 } }));
  for (const row of rows) {
    const week = result[Math.min(Math.max(row.week, 0), weeks - 1)]!;
    if ((TREND_CONCLUSIONS as readonly string[]).includes(row.conclusion ?? "")) week.counts[row.conclusion as TrendConclusion] += row.count;
  }
  return result;
}

const ACTIVITY_LIMIT = 10;

export type ActivityKind = "run_completed" | "run_failed";

export interface ActivityItem {
  kind: ActivityKind;
  at: Date;
  /** The record it happened to: its name and its page. */
  record: { name: string; href: string };
}

/** The +limit+ most recently finished Runs, newest first, in one query. */
export function recentActivity(db: Executor, limit = ACTIVITY_LIMIT): ActivityItem[] {
  // Each names its Run, "Run #4 · Salt adherence, fleet", so links to different Runs never share a text.
  const rows = db.all<{ kind: ActivityKind; at: number; name: string; href: string }>(sql`
    select case r.state when 'failed' then 'run_failed' else 'run_completed' end as kind, r.finished_at as at,
      'Run #' || (select count(*) from assessments earlier where earlier.initiative_id = r.initiative_id and earlier.id <= r.id) || ' · ' || i.name as name,
      '/runs/' || r.public_id as href
    from assessments r join initiatives i on i.id = r.initiative_id
    where r.finished_at is not null and r.state in ('complete', 'complete_with_issues', 'failed')
    order by at desc, r.id desc
    limit ${limit}`);
  return rows.map((row) => ({ kind: row.kind, at: new Date(row.at), record: { name: row.name, href: row.href } }));
}
