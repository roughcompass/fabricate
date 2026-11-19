import { eq, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { type Issue, ValidationError } from "@/lib/db/errors";
import { runTargets, assessmentTargets, assessments, repositories } from "@/lib/db/schema";
import { CloneUrl, InvalidCloneUrl } from "./clone-url";
import { repositoryNameFromUrl } from "./repository-name";
import { BoundaryViolation, SourceBoundary } from "./source-boundary";
import { versionCount } from "@/lib/profiling/versions";
import { requestBackgroundSurvey } from "@/lib/surveys/background";
import { getConfig } from "@/lib/config";
import { deleteRepositoryPreviews, discardPreviewFiles } from "@/lib/previews/lifecycle";
import { previewCount } from "@/lib/previews/views";
import { type Repository, getRepository, insertRepository, repositoryFieldIssues, updateRepository } from "./repository-records";
import { updateLocked } from "@/lib/db/optimistic";

/**
 * Catalog operations for the web UI: parse and canonicalize the clone URL,
 * confine local paths to the source boundary, then persist. Every problem is
 * reported at once, addressed to its field, and nothing is written unless the
 * whole submission is valid.
 *
 * A Repository is profiled whenever what it names changes: when it's added
 * and when its clone URL or reference is edited (docs/profiling.md).
 */

export interface RepositoryForm {
  /** Blank for the clone URL's owner and repository, such as vickykatoch-helios. */
  name: string;
  cloneUrl: string;
  gitRef: string;
}

/** +form+ with a blank name replaced by its clone URL's owner and repository. */
function named(form: RepositoryForm): RepositoryForm {
  return form.name.trim() ? form : { ...form, name: repositoryNameFromUrl(form.cloneUrl) };
}

interface ResolvedUrl {
  cloneUrl: string;
  canonicalUrl: string;
}

/** Parses a submitted clone URL; local paths are confined and resolved. */
export function resolveCloneUrl(input: string, boundary = new SourceBoundary()): ResolvedUrl {
  const url = CloneUrl.parse(input);
  if (!url.isFile) return { cloneUrl: url.toString(), canonicalUrl: url.canonical };

  const location = boundary.check(url.localPath!);
  const resolved = CloneUrl.forLocalPath(location.path);
  return { cloneUrl: resolved.toString(), canonicalUrl: resolved.canonical };
}

export function registerRepository(db: Executor, submitted: RepositoryForm, boundary?: SourceBoundary): Repository {
  const form = named(submitted);
  const url = resolveOrReject(form, boundary);
  return immediate(db, (tx) => {
    const repository = insertRepository(tx, { name: form.name, gitRef: form.gitRef, ...url });
    requestBackgroundSurvey(tx, repository, "added");
    return repository;
  });
}

export function editRepository(db: Executor, publicId: string, lockVersion: number, submitted: RepositoryForm, boundary?: SourceBoundary): Repository {
  const form = named(submitted);
  const url = resolveOrReject(form, boundary);
  return immediate(db, (tx) => {
    const before = getRepository(tx, publicId);
    const repository = updateRepository(tx, publicId, lockVersion, { name: form.name, gitRef: form.gitRef, ...url });
    if (repository.canonicalUrl !== before.canonicalUrl || repository.gitRef !== before.gitRef) requestBackgroundSurvey(tx, repository, "edited");
    return repository;
  });
}

export interface DeletionEffects {
  /** Its versions, which stay with it for the history of the Runs that used them. */
  readonly versions: number;
  /** Assessments that select it, which stop selecting it. */
  readonly assessments: readonly string[];
  /** Runs of Assessments that included it, whose results stay. */
  readonly runs: number;
  /** Its previews, which are deleted with their files (docs/previews.md). */
  readonly previews: number;
}

/** What deleting +source+ changes, for the confirmation to state. */
export function deletionEffects(db: Executor, repository: Repository): DeletionEffects {
  const selecting = db
    .select({ name: assessments.name })
    .from(assessmentTargets)
    .innerJoin(assessments, eq(assessments.id, assessmentTargets.assessmentId))
    .where(eq(assessmentTargets.repositoryId, repository.id))
    .orderBy(sql`lower(${assessments.name})`)
    .all();
  return { versions: versionCount(db, repository.id), assessments: selecting.map((row) => row.name), runs: runCounts(db).get(repository.id) ?? 0, previews: previewCount(db, repository) };
}

/**
 * Deletes +source+ from the catalog, permanently, once +confirmation+ is its
 * name exactly. It leaves every list, scope, and profiling check, and its
 * clone URL is free to register again. A survey in progress finishes, and
 * Assessments that select it stop selecting it. Past Runs keep
 * their results, which name it as they assessed it. Its previews are deleted
 * with it, and their files removed (docs/previews.md).
 */
export function deleteRepository(db: Executor, publicId: string, confirmation: string): Repository {
  const { deleted, previews } = immediate(db, (tx) => {
    const repository = getRepository(tx, publicId);
    if (confirmation.trim() !== repository.name) throw new ValidationError([{ field: "confirmation", message: `Type ${repository.name} to confirm` }]);
    tx.delete(assessmentTargets).where(eq(assessmentTargets.repositoryId, repository.id)).run();
    const now = new Date();
    return {
      previews: deleteRepositoryPreviews(tx, repository.id),
      deleted: updateLocked(tx, repositories, repository, { deletedAt: now, updatedAt: now }, `${repository.name} was changed while it was being deleted`),
    };
  });
  // The previews stopped serving with the commit; their directories move aside now and are removed in the background.
  void discardPreviewFiles(getConfig(), previews);
  return deleted;
}

/** How many Runs of Assessments included each source, keyed by source row id. */
export function runCounts(db: Executor): Map<number, number> {
  const rows = db
    .select({ repositoryId: runTargets.repositoryId, count: sql<number>`count(distinct ${runTargets.runId})` })
    .from(runTargets)
    .groupBy(runTargets.repositoryId)
    .all();
  // Template targets have no source.
  return new Map(rows.flatMap((row) => (row.repositoryId === null ? [] : [[row.repositoryId, row.count] as const])));
}

/** Resolves the URL, or throws every URL and field problem together. */
function resolveOrReject(form: RepositoryForm, boundary?: SourceBoundary): ResolvedUrl {
  let urlIssue: Issue | null = null;
  let url: ResolvedUrl | null = null;
  try {
    url = resolveCloneUrl(form.cloneUrl, boundary);
  } catch (error) {
    if (!(error instanceof InvalidCloneUrl || error instanceof BoundaryViolation)) throw error;
    urlIssue = { field: "cloneUrl", message: error.message };
  }
  if (!url) throw new ValidationError([urlIssue!, ...repositoryFieldIssues(form)]);
  return url;
}
