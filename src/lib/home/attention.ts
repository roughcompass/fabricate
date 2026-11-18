import { sql } from "drizzle-orm";
import type { FabricateConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { deConsoleStatus, openDeConsoleConflicts } from "@/lib/ownership/de-console";

/**
 * Home's Needs attention list (home spec): the problems that hold now, each
 * with the time it began, newest first. Run and Evaluation problems come from
 * each Assessment's latest Run and latest Evaluation, so a later success
 * replaces an earlier failure. The reads are a fixed number of queries
 * whatever the number of Assessments.
 */

/** DE Console values are out of date once three scheduled reads have gone by without a success (design decision 5). */
const STALE_AFTER_INTERVALS = 3;

/** How many items one page of the list shows. */
export const ATTENTION_PAGE_SIZE = 20;

interface AssessmentRef {
  publicId: string;
  name: string;
}

export type AttentionItem =
  | { kind: "run_failed"; since: Date; assessment: AssessmentRef; run: { publicId: string; number: number } }
  | { kind: "run_with_issues"; since: Date; assessment: AssessmentRef; run: { publicId: string; number: number }; unassessed: number }
  | { kind: "evaluation_failed"; since: Date; assessment: AssessmentRef; evaluation: { publicId: string; number: number } }
  | { kind: "de_console_failed"; since: Date; lastSuccess: Date | null }
  | { kind: "de_console_stale"; since: Date; refreshMinutes: number }
  | { kind: "de_console_conflicts"; since: Date; count: number };

export function attentionItems(db: Executor, config: Pick<FabricateConfig, "deConsole">, now: Date = new Date()): AttentionItem[] {
  const items: AttentionItem[] = [...runProblems(db), ...evaluationProblems(db), ...deConsoleProblems(db, config, now)];
  return items.sort((a, b) => b.since.getTime() - a.since.getTime());
}

/**
 * Each Assessment's latest Run, when it failed or couldn't assess every
 * Repository. Runs are numbered by id within their Assessment, as the Run
 * pages number them. Repository profiling Runs are left out: the
 * Repositories list shows a failed profile version on its repository.
 */
function runProblems(db: Executor): AttentionItem[] {
  const rows = db.all<{ public_id: string; state: "failed" | "complete_with_issues"; number: number; since: number; assessment_public_id: string; name: string; unassessed: number }>(sql`
    with numbered as (
      select a.id, a.public_id, a.initiative_id, a.state, coalesce(a.finished_at, a.created_at) as since,
        row_number() over (partition by a.initiative_id order by a.id) as number,
        row_number() over (partition by a.initiative_id order by a.id desc) as recency
      from assessments a
    )
    select n.public_id, n.state, n.number, n.since, i.public_id as assessment_public_id, i.name,
      (select count(*) from assessment_targets t where t.assessment_id = n.id and t.state = 'failed') as unassessed
    from numbered n
    join initiatives i on i.id = n.initiative_id
    where n.recency = 1 and n.state in ('failed', 'complete_with_issues') and i.profiling = 0`);
  return rows.map((row): AttentionItem => {
    const common = { since: new Date(row.since), assessment: { publicId: row.assessment_public_id, name: row.name }, run: { publicId: row.public_id, number: row.number } };
    return row.state === "failed" ? { kind: "run_failed", ...common } : { kind: "run_with_issues", ...common, unassessed: row.unassessed };
  });
}

/** Each Assessment's latest Evaluation, when it failed. */
function evaluationProblems(db: Executor): AttentionItem[] {
  const rows = db.all<{ public_id: string; number: number; since: number; assessment_public_id: string; name: string }>(sql`
    with numbered as (
      select e.id, e.public_id, e.initiative_id, e.state, coalesce(e.finished_at, e.created_at) as since,
        row_number() over (partition by e.initiative_id order by e.id) as number,
        row_number() over (partition by e.initiative_id order by e.id desc) as recency
      from evaluations e
    )
    select n.public_id, n.number, n.since, i.public_id as assessment_public_id, i.name
    from numbered n
    join initiatives i on i.id = n.initiative_id
    where n.recency = 1 and n.state = 'failed'`);
  return rows.map((row) => ({ kind: "evaluation_failed", since: new Date(row.since), assessment: { publicId: row.assessment_public_id, name: row.name }, evaluation: { publicId: row.public_id, number: row.number } }));
}

/**
 * The DE Console import's problems. Read problems count only while a source
 * is configured; open conflicts remain from earlier reads either way, and
 * all of them make one item.
 */
function deConsoleProblems(db: Executor, config: Pick<FabricateConfig, "deConsole">, now: Date): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { lastSuccess, lastAttempt } = deConsoleStatus(db);
  if (config.deConsole.source) {
    if (lastAttempt?.status === "failed") {
      items.push({ kind: "de_console_failed", since: lastAttempt.readAt, lastSuccess: lastSuccess?.readAt ?? null });
    } else if (lastSuccess && isStale(lastSuccess.readAt, config.deConsole.refreshMinutes, now)) {
      items.push({ kind: "de_console_stale", since: lastSuccess.readAt, refreshMinutes: config.deConsole.refreshMinutes });
    }
  }
  const conflicts = openDeConsoleConflicts(db);
  if (conflicts.length > 0) {
    items.push({ kind: "de_console_conflicts", since: new Date(Math.max(...conflicts.map((conflict) => conflict.recordedAt.getTime()))), count: conflicts.length });
  }
  return items;
}

/** Whether a successful read is older than three refresh intervals. The DE Console import page uses the same rule for its alert. */
export function isStale(readAt: Date, refreshMinutes: number, now: Date = new Date()): boolean {
  return now.getTime() - readAt.getTime() > STALE_AFTER_INTERVALS * refreshMinutes * 60_000;
}
