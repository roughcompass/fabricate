import { sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";

/**
 * Home's Needs attention list (home spec): the problems that hold now, each
 * with the time it began, newest first. Run and Evaluation problems come from
 * each Assessment's latest Run and latest Evaluation, so a later success
 * replaces an earlier failure. Problems that began in the same millisecond
 * list the newer record first. The reads are a fixed number of queries
 * whatever the number of Assessments.
 */

/** How many items one page of the list shows. */
export const ATTENTION_PAGE_SIZE = 20;

interface AssessmentRef {
  publicId: string;
  name: string;
}

export type AttentionItem =
  | { kind: "run_failed"; since: Date; assessment: AssessmentRef; run: { publicId: string; number: number } }
  | { kind: "run_with_issues"; since: Date; assessment: AssessmentRef; run: { publicId: string; number: number }; unassessed: number }
  | { kind: "evaluation_failed"; since: Date; assessment: AssessmentRef; evaluation: { publicId: string; number: number } };

export function attentionItems(db: Executor): AttentionItem[] {
  const items: AttentionItem[] = [...runProblems(db), ...evaluationProblems(db)];
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
    where n.recency = 1 and n.state in ('failed', 'complete_with_issues') and i.profiling = 0
    order by n.id desc`);
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
    where n.recency = 1 and n.state = 'failed'
    order by n.id desc`);
  return rows.map((row) => ({ kind: "evaluation_failed", since: new Date(row.since), assessment: { publicId: row.assessment_public_id, name: row.name }, evaluation: { publicId: row.public_id, number: row.number } }));
}
