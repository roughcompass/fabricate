import { asc, eq, isNull, sql } from "drizzle-orm";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { Executor } from "@/lib/db/client";
import { initiativeTargets, repositorySources } from "@/lib/db/schema";
import type { Initiative } from "@/lib/initiatives/initiative-records";

/**
 * Resolves an Initiative's target policy into the ordered catalog sources an
 * Assessment will copy. Run it inside the launch transaction, which holds
 * SQLite's write lock, so the rows it reads cannot change before the scope
 * snapshot is written.
 *
 * Resolution never narrows a scope silently: an empty scope, or an explicit
 * selection that names a missing source, fails with one problem
 * per offending source.
 */

export interface ScopeProblem {
  sourcePublicId: string | null;
  sourceName: string | null;
  message: string;
}

export class ScopeResolutionError extends Error {
  override name = "ScopeResolutionError";

  constructor(readonly problems: readonly ScopeProblem[]) {
    super(problems.map((problem) => problem.message).join(" "));
  }
}

const byCatalogOrder = [sql`lower(${repositorySources.name})`, asc(repositorySources.publicId)] as const;

export function resolveScope(db: Executor, initiative: Initiative): RepositorySource[] {
  return initiative.selectionMode === "all" ? allSources(db) : explicitSources(db, initiative);
}

function allSources(db: Executor): RepositorySource[] {
  const sources = db.select().from(repositorySources).where(isNull(repositorySources.deletedAt)).orderBy(...byCatalogOrder).all();
  if (sources.length === 0) {
    throw new ScopeResolutionError([{ sourcePublicId: null, sourceName: null, message: "The scope is empty: there are no Repositories. Add one before starting a Run." }]);
  }
  return sources;
}

function explicitSources(db: Executor, initiative: Initiative): RepositorySource[] {
  const rows = db
    .select({ selection: initiativeTargets, source: repositorySources })
    .from(initiativeTargets)
    .leftJoin(repositorySources, eq(repositorySources.id, initiativeTargets.repositorySourceId))
    .where(eq(initiativeTargets.initiativeId, initiative.id))
    .orderBy(...byCatalogOrder, asc(initiativeTargets.id))
    .all();

  if (rows.length === 0) {
    throw new ScopeResolutionError([
      { sourcePublicId: null, sourceName: null, message: "The scope is empty: this Assessment's explicit scope selects no Repositories." },
    ]);
  }

  const problems: ScopeProblem[] = [];
  for (const { selection, source } of rows) {
    if (!source) {
      problems.push({
        sourcePublicId: null,
        sourceName: null,
        message: `A selected Repository (record ${selection.repositorySourceId}) no longer exists. Edit the Assessment's scope to remove it.`,
      });
    } else if (source.deletedAt) {
      problems.push({ sourcePublicId: source.publicId, sourceName: source.name, message: `${source.name} (${source.publicId}) was deleted. Edit the Assessment's scope to remove it.` });
    }
  }
  if (problems.length) throw new ScopeResolutionError(problems);
  return rows.map((row) => row.source!);
}
