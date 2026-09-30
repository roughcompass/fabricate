import { asc, eq, sql } from "drizzle-orm";
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
 * selection that names a missing or disabled source, fails with one problem
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
  return initiative.selectionMode === "all_enabled" ? allEnabledSources(db) : explicitSources(db, initiative);
}

function allEnabledSources(db: Executor): RepositorySource[] {
  const sources = db.select().from(repositorySources).where(eq(repositorySources.enabled, true)).orderBy(...byCatalogOrder).all();
  if (sources.length === 0) {
    throw new ScopeResolutionError([
      { sourcePublicId: null, sourceName: null, message: "The scope is empty: no repository sources are enabled. Add or enable a source before starting an assessment." },
    ]);
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
      { sourcePublicId: null, sourceName: null, message: "The scope is empty: this initiative's explicit scope selects no repository sources." },
    ]);
  }

  const problems: ScopeProblem[] = [];
  for (const { selection, source } of rows) {
    if (!source) {
      problems.push({
        sourcePublicId: null,
        sourceName: null,
        message: `A selected repository source (catalog record ${selection.repositorySourceId}) no longer exists. Edit the initiative's scope to remove it.`,
      });
    } else if (!source.enabled) {
      problems.push({
        sourcePublicId: source.publicId,
        sourceName: source.name,
        message: `${source.name} (${source.publicId}) is disabled. Enable it in Sources or remove it from this initiative's scope.`,
      });
    }
  }
  if (problems.length) throw new ScopeResolutionError(problems);
  return rows.map((row) => row.source!);
}
