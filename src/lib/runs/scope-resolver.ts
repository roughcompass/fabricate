import { asc, eq, isNull, sql } from "drizzle-orm";
import type { Repository } from "@/lib/repositories/repository-records";
import type { Executor } from "@/lib/db/client";
import { assessmentTargets, repositories } from "@/lib/db/schema";
import type { Assessment } from "@/lib/assessments/assessment-records";

/**
 * Resolves an Assessment's target policy into the ordered Repositories a Run
 * will copy. Run it inside the launch transaction, which holds
 * SQLite's write lock, so the rows it reads cannot change before the scope
 * snapshot is written.
 *
 * Resolution never narrows a scope silently: an empty scope, or an explicit
 * selection that names a missing Repository, fails with one problem
 * per offending Repository.
 */

export interface ScopeProblem {
  repositoryPublicId: string | null;
  repositoryName: string | null;
  message: string;
}

export class ScopeResolutionError extends Error {
  override name = "ScopeResolutionError";

  constructor(readonly problems: readonly ScopeProblem[]) {
    super(problems.map((problem) => problem.message).join(" "));
  }
}

const byNameOrder = [sql`lower(${repositories.name})`, asc(repositories.publicId)] as const;

export function resolveScope(db: Executor, assessment: Assessment): Repository[] {
  return assessment.selectionMode === "all" ? allRepositories(db) : explicitRepositories(db, assessment);
}

function allRepositories(db: Executor): Repository[] {
  const registered = db.select().from(repositories).where(isNull(repositories.deletedAt)).orderBy(...byNameOrder).all();
  if (registered.length === 0) {
    throw new ScopeResolutionError([{ repositoryPublicId: null, repositoryName: null, message: "The scope is empty: there are no Repositories. Add one before starting a Run." }]);
  }
  return registered;
}

function explicitRepositories(db: Executor, assessment: Assessment): Repository[] {
  const rows = db
    .select({ selection: assessmentTargets, repository: repositories })
    .from(assessmentTargets)
    .leftJoin(repositories, eq(repositories.id, assessmentTargets.repositoryId))
    .where(eq(assessmentTargets.assessmentId, assessment.id))
    .orderBy(...byNameOrder, asc(assessmentTargets.id))
    .all();

  if (rows.length === 0) {
    throw new ScopeResolutionError([
      { repositoryPublicId: null, repositoryName: null, message: "The scope is empty: this Assessment's explicit scope selects no Repositories." },
    ]);
  }

  const problems: ScopeProblem[] = [];
  for (const { selection, repository } of rows) {
    if (!repository) {
      problems.push({
        repositoryPublicId: null,
        repositoryName: null,
        message: `A selected Repository (record ${selection.repositoryId}) no longer exists. Edit the Assessment's scope to remove it.`,
      });
    } else if (repository.deletedAt) {
      problems.push({ repositoryPublicId: repository.publicId, repositoryName: repository.name, message: `${repository.name} (${repository.publicId}) was deleted. Edit the Assessment's scope to remove it.` });
    }
  }
  if (problems.length) throw new ScopeResolutionError(problems);
  return rows.map((row) => row.repository!);
}
