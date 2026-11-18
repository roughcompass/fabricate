import { sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { CONCLUSION_FILTERS, type ConclusionFilter, isConclusionFilter } from "@/lib/evaluations/conclusions";
import type { FleetSummary } from "./summary";

/*
 * Home's dashboard readers (home spec), each a fixed number of queries
 * whatever the size of the fleet: every figure as it stood seven days ago,
 * the Assessment trend by week, and the recent activity.
 */

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The figures as they stood at +cutoff+, to state each one's change since then. */
export interface FiguresThen {
  repositories: { enabled: number; claimed: number; unclaimed: number };
  assessments: { total: number; byConclusion: Record<ConclusionFilter, number> };
}

/**
 * The figures as of +cutoff+, from when each record was created and when each
 * claim and Evaluation happened. Whether a Repository is enabled isn't kept
 * over time, so it's read as it is now.
 */
export function figuresAt(db: Executor, cutoff: Date): FiguresThen {
  const at = cutoff.getTime();
  const repositories = db.get<{ enabled: number | null; claimed: number | null }>(sql`
    select sum(case when s.enabled then 1 else 0 end) as enabled,
      sum(case when s.enabled and exists (
        select 1 from ownership_assertions a
        where a.subject_repository_source_id = s.id and a.attribute = 'application' and a.recorded_at <= ${at}
          and not exists (
            select 1 from ownership_supersessions x join ownership_assertions b on b.id = x.assertion_id
            where x.superseded_id = a.id and b.recorded_at <= ${at}
          )
      ) then 1 else 0 end) as claimed
    from repository_sources s
    where s.created_at <= ${at}`);
  const conclusions = db.all<{ conclusion: string | null }>(sql`
    with latest as (
      select e.initiative_id, e.summary, row_number() over (partition by e.initiative_id order by e.id desc) as recency
      from evaluations e
      where e.state = 'complete' and coalesce(e.finished_at, e.created_at) <= ${at}
    )
    select json_extract(l.summary, '$.combined.conclusion') as conclusion
    from initiatives i
    left join latest l on l.initiative_id = i.id and l.recency = 1
    where i.claim_repository_source_id is null and i.system_owned = 0 and i.profiling = 0 and i.created_at <= ${at}`);
  const byConclusion = Object.fromEntries(CONCLUSION_FILTERS.map((filter) => [filter, 0])) as Record<ConclusionFilter, number>;
  for (const { conclusion } of conclusions) byConclusion[isConclusionFilter(conclusion) ? conclusion : "none"]++;
  const enabled = repositories?.enabled ?? 0;
  const claimed = repositories?.claimed ?? 0;
  return {
    repositories: { enabled, claimed, unclaimed: enabled - claimed },
    assessments: { total: conclusions.length, byConclusion },
  };
}

/** How a figure changed over the week: "+2 this week", "−1 this week", or "No change this week". */
export function weekChange(now: number, then: number, unit = ""): string {
  const change = now - then;
  if (change === 0) return "No change this week";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)}${unit} this week`;
}

/** The figures' changes over the last seven days, keyed as Home shows them: Assessments' by conclusion. */
export function figureChanges(summary: FleetSummary, then: FiguresThen, share: (counts: { enabled: number; claimed: number }) => number | null): Record<string, string> {
  const shareNow = share(summary.repositories);
  const shareThen = share(then.repositories);
  return {
    enabled: weekChange(summary.repositories.enabled, then.repositories.enabled),
    claimed: weekChange(summary.repositories.claimed, then.repositories.claimed),
    claimedShare: shareNow === null || shareThen === null ? "No change this week" : weekChange(shareNow, shareThen, " pts"),
    unclaimed: weekChange(summary.repositories.unclaimed, then.repositories.unclaimed),
    assessments: weekChange(summary.assessments.total, then.assessments.total),
    ...Object.fromEntries(CONCLUSION_FILTERS.map((filter) => [filter, weekChange(summary.assessments.byConclusion[filter], then.assessments.byConclusion[filter])])),
  };
}

export const TREND_WEEKS = 8;

/** The conclusions the trend charts, in stacking order. */
export const TREND_CONCLUSIONS = ["gaps", "undetermined", "conforms", "not_applicable"] as const satisfies readonly ConclusionFilter[];
export type TrendConclusion = (typeof TREND_CONCLUSIONS)[number];

export interface TrendWeek {
  /** The week's first day. */
  start: Date;
  counts: Record<TrendConclusion, number>;
}

/** How many Evaluations of operator-created Assessments completed with each conclusion, in each of the last +weeks+ seven-day windows, oldest first, the last ending at +now+. */
export function assessmentTrend(db: Executor, now: Date = new Date(), weeks = TREND_WEEKS): TrendWeek[] {
  const end = now.getTime();
  const start = end - weeks * WEEK_MS;
  const rows = db.all<{ week: number; conclusion: string | null; count: number }>(sql`
    select cast((coalesce(e.finished_at, e.created_at) - ${start}) / ${WEEK_MS} as integer) as week,
      json_extract(e.summary, '$.combined.conclusion') as conclusion, count(*) as count
    from evaluations e
    join initiatives i on i.id = e.initiative_id
    where e.state = 'complete' and coalesce(e.finished_at, e.created_at) > ${start} and coalesce(e.finished_at, e.created_at) <= ${end}
      and i.claim_repository_source_id is null and i.system_owned = 0 and i.profiling = 0
    group by week, conclusion`);
  const result: TrendWeek[] = Array.from({ length: weeks }, (_, index) => ({ start: new Date(start + index * WEEK_MS), counts: { gaps: 0, undetermined: 0, conforms: 0, not_applicable: 0 } }));
  for (const row of rows) {
    const week = result[Math.min(Math.max(row.week, 0), weeks - 1)]!;
    if ((TREND_CONCLUSIONS as readonly string[]).includes(row.conclusion ?? "")) week.counts[row.conclusion as TrendConclusion] += row.count;
  }
  return result;
}

export const ACTIVITY_LIMIT = 10;

export type ActivityKind = "run_completed" | "run_failed";

export interface ActivityItem {
  kind: ActivityKind;
  at: Date;
  /** The record it happened to: its name and its page. */
  record: { name: string; href: string };
}

/** The +limit+ most recently finished Runs, newest first, in one query. */
export function recentActivity(db: Executor, limit = ACTIVITY_LIMIT): ActivityItem[] {
  const rows = db.all<{ kind: ActivityKind; at: number; name: string; href: string }>(sql`
    select case r.state when 'failed' then 'run_failed' else 'run_completed' end as kind, r.finished_at as at, i.name as name, '/runs/' || r.public_id as href
    from assessments r join initiatives i on i.id = r.initiative_id
    where r.finished_at is not null and r.state in ('complete', 'complete_with_issues', 'failed') and i.claim_repository_source_id is null and i.system_owned = 0 and i.profiling = 0
    order by at desc, r.id desc
    limit ${limit}`);
  return rows.map((row) => ({ kind: row.kind, at: new Date(row.at), record: { name: row.name, href: row.href } }));
}
