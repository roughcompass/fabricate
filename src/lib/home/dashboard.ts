import { sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { CONCLUSION_FILTERS, type ConclusionFilter, isConclusionFilter } from "@/lib/evaluations/conclusions";
import type { PortalLifecycle } from "@/lib/onboarding/vocabulary";
import type { FleetSummary } from "./summary";

/*
 * Home's dashboard readers (home spec, update-portal-management-journey
 * design decision 8), each a fixed number of queries whatever the size of the
 * fleet: every figure as it stood seven days ago, the Portals overview, the
 * Assessment trend by week, and the recent activity.
 */

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The figures as they stood at +cutoff+, to state each one's change since then. */
export interface FiguresThen {
  repositories: { enabled: number; claimed: number; unclaimed: number };
  assessments: { total: number; byConclusion: Record<ConclusionFilter, number> };
  applications: { applications: number; undetermined: number; productionPortals: number };
}

/**
 * The figures as of +cutoff+, from when each record was created and when each
 * claim, Evaluation, and lifecycle change happened. Two facts aren't kept
 * over time and are read as they are now: whether a Repository is enabled,
 * and an Application's rendering determination.
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
    where i.claim_repository_source_id is null and i.system_owned = 0 and i.de_web = 0 and i.created_at <= ${at}`);
  const byConclusion = Object.fromEntries(CONCLUSION_FILTERS.map((filter) => [filter, 0])) as Record<ConclusionFilter, number>;
  for (const { conclusion } of conclusions) byConclusion[isConclusionFilter(conclusion) ? conclusion : "none"]++;
  const applications = db.get<{ applications: number; undetermined: number; production_portals: number }>(sql`
    select
      (select count(*) from applications where repository_source_id is not null and created_at <= ${at}) as applications,
      (select count(*) from applications where repository_source_id is not null and created_at <= ${at} and rendering_mode = 'undetermined') as undetermined,
      (select count(*) from (
        select e.portal_id, e.to_lifecycle, row_number() over (partition by e.portal_id order by e.occurred_at desc, e.id desc) as recency
        from onboarding_events e
        where e.portal_id is not null and e.to_lifecycle is not null and e.occurred_at <= ${at}
      ) where recency = 1 and to_lifecycle = 'production') as production_portals`)!;
  const enabled = repositories?.enabled ?? 0;
  const claimed = repositories?.claimed ?? 0;
  return {
    repositories: { enabled, claimed, unclaimed: enabled - claimed },
    assessments: { total: conclusions.length, byConclusion },
    applications: { applications: applications.applications, undetermined: applications.undetermined, productionPortals: applications.production_portals },
  };
}

/** How a figure changed over the week: "+2 this week", "−1 this week", or "No change this week". */
export function weekChange(now: number, then: number, unit = ""): string {
  const change = now - then;
  if (change === 0) return "No change this week";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)}${unit} this week`;
}

/** The figures' changes over the last seven days, keyed as Home shows them. */
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
    applications: weekChange(summary.applications.applications, then.applications.applications),
    undetermined: weekChange(summary.applications.undetermined, then.applications.undetermined),
    productionPortals: weekChange(summary.applications.productionPortals, then.applications.productionPortals),
  };
}

export const PORTALS_OVERVIEW_LIMIT = 12;

export interface PortalOverview {
  publicId: string;
  label: string;
  lifecycle: PortalLifecycle;
  applications: number;
  /** When its experience was last saved, or null before its first save. */
  savedAt: Date | null;
}

/** The onboarded Portals, those in Production first and then by name, with their Application counts and last save; at most +limit+, and how many there are. */
export function portalsOverview(db: Executor, limit = PORTALS_OVERVIEW_LIMIT): { portals: PortalOverview[]; total: number } {
  const rows = db.all<{ public_id: string; label: string; lifecycle: PortalLifecycle; applications: number; saved_at: number | null; total: number }>(sql`
    select p.public_id, p.label, p.lifecycle,
      (select count(*) from applications a where a.portal_id = p.id and a.repository_source_id is not null) as applications,
      (select max(e.occurred_at) from onboarding_events e where e.portal_id = p.id and e.event = 'experience_saved') as saved_at,
      count(*) over () as total
    from portals p
    where exists (select 1 from onboarding_events e where e.portal_id = p.id)
    order by case p.lifecycle when 'production' then 0 else 1 end, p.label_key, p.public_id
    limit ${limit}`);
  return {
    total: rows[0]?.total ?? 0,
    portals: rows.map((row) => ({ publicId: row.public_id, label: row.label, lifecycle: row.lifecycle, applications: row.applications, savedAt: row.saved_at === null ? null : new Date(row.saved_at) })),
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
      and i.claim_repository_source_id is null and i.system_owned = 0 and i.de_web = 0
    group by week, conclusion`);
  const result: TrendWeek[] = Array.from({ length: weeks }, (_, index) => ({ start: new Date(start + index * WEEK_MS), counts: { gaps: 0, undetermined: 0, conforms: 0, not_applicable: 0 } }));
  for (const row of rows) {
    const week = result[Math.min(Math.max(row.week, 0), weeks - 1)]!;
    if ((TREND_CONCLUSIONS as readonly string[]).includes(row.conclusion ?? "")) week.counts[row.conclusion as TrendConclusion] += row.count;
  }
  return result;
}

export const ACTIVITY_LIMIT = 10;

export type ActivityKind = "portal_created" | "portal_promoted" | "portal_returned" | "experience_saved" | "application_created" | "run_completed" | "run_failed";

export interface ActivityItem {
  kind: ActivityKind;
  at: Date;
  /** Who stated they did it, or null where nobody did, such as a Run. */
  actor: string | null;
  /** The record it happened to: its name and its page. */
  record: { name: string; href: string };
}

/** The +limit+ most recent of Portal and Application events and finished Runs, newest first, in one query. */
export function recentActivity(db: Executor, limit = ACTIVITY_LIMIT): ActivityItem[] {
  const rows = db.all<{ kind: ActivityKind; at: number; actor: string | null; name: string; href: string }>(sql`
    select * from (
      select case e.event when 'created' then 'portal_created' when 'promoted' then 'portal_promoted' when 'returned_to_prototype' then 'portal_returned' else 'experience_saved' end as kind,
        e.occurred_at as at, case e.attribution when 'system' then null else e.actor end as actor, p.label as name, '/portals/' || p.public_id as href, e.id as tiebreak
      from onboarding_events e join portals p on p.id = e.portal_id
      where e.event in ('created', 'promoted', 'returned_to_prototype', 'experience_saved')
      union all
      select 'application_created' as kind, a.created_at as at, a.created_by as actor, a.name as name, '/applications/' || a.public_id as href, a.id as tiebreak
      from applications a where a.repository_source_id is not null
      union all
      select case r.state when 'failed' then 'run_failed' else 'run_completed' end as kind, r.finished_at as at, null as actor, i.name as name, '/runs/' || r.public_id as href, r.id as tiebreak
      from assessments r join initiatives i on i.id = r.initiative_id
      where r.finished_at is not null and r.state in ('complete', 'complete_with_issues', 'failed') and i.claim_repository_source_id is null and i.system_owned = 0 and i.de_web = 0
    )
    order by at desc, tiebreak desc
    limit ${limit}`);
  return rows.map((row) => ({ kind: row.kind, at: new Date(row.at), actor: row.actor, record: { name: row.name, href: row.href } }));
}
