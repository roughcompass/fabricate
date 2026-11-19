import { eq, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { type Issue, ValidationError } from "@/lib/db/errors";
import { runTargets, assessmentTargets, assessments, repositorySources } from "@/lib/db/schema";
import { CloneUrl, InvalidCloneUrl } from "./clone-url";
import { repositoryNameFromUrl } from "./repository-name";
import { BoundaryViolation, SourceBoundary } from "./source-boundary";
import { versionCount } from "@/lib/profiling/versions";
import { requestBackgroundSurvey } from "@/lib/surveys/background";
import { getConfig } from "@/lib/config";
import { deleteRepositoryPreviews, discardPreviewFiles } from "@/lib/previews/lifecycle";
import { previewCount } from "@/lib/previews/views";
import { type RepositorySource, getSource, insertSource, sourceFieldIssues, updateSource } from "./source-records";
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

export interface SourceForm {
  /** Blank for the clone URL's owner and repository, such as vickykatoch-helios. */
  name: string;
  cloneUrl: string;
  gitRef: string;
}

/** +form+ with a blank name replaced by its clone URL's owner and repository. */
function named(form: SourceForm): SourceForm {
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

export function registerSource(db: Executor, submitted: SourceForm, boundary?: SourceBoundary): RepositorySource {
  const form = named(submitted);
  const url = resolveOrReject(form, boundary);
  return immediate(db, (tx) => {
    const source = insertSource(tx, { name: form.name, gitRef: form.gitRef, ...url });
    requestBackgroundSurvey(tx, source, "added");
    return source;
  });
}

export function editSource(db: Executor, publicId: string, lockVersion: number, submitted: SourceForm, boundary?: SourceBoundary): RepositorySource {
  const form = named(submitted);
  const url = resolveOrReject(form, boundary);
  return immediate(db, (tx) => {
    const before = getSource(tx, publicId);
    const source = updateSource(tx, publicId, lockVersion, { name: form.name, gitRef: form.gitRef, ...url });
    if (source.canonicalUrl !== before.canonicalUrl || source.gitRef !== before.gitRef) requestBackgroundSurvey(tx, source, "edited");
    return source;
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
export function deletionEffects(db: Executor, source: RepositorySource): DeletionEffects {
  const selecting = db
    .select({ name: assessments.name })
    .from(assessmentTargets)
    .innerJoin(assessments, eq(assessments.id, assessmentTargets.assessmentId))
    .where(eq(assessmentTargets.repositorySourceId, source.id))
    .orderBy(sql`lower(${assessments.name})`)
    .all();
  return { versions: versionCount(db, source.id), assessments: selecting.map((row) => row.name), runs: runCounts(db).get(source.id) ?? 0, previews: previewCount(db, source) };
}

/**
 * Deletes +source+ from the catalog, permanently, once +confirmation+ is its
 * name exactly. It leaves every list, scope, and profiling check, and its
 * clone URL is free to register again. A survey in progress finishes, and
 * Assessments that select it stop selecting it. Past Runs keep
 * their results, which name it as they assessed it. Its previews are deleted
 * with it, and their files removed (docs/previews.md).
 */
export function deleteSource(db: Executor, publicId: string, confirmation: string): RepositorySource {
  const { deleted, previews } = immediate(db, (tx) => {
    const source = getSource(tx, publicId);
    if (confirmation.trim() !== source.name) throw new ValidationError([{ field: "confirmation", message: `Type ${source.name} to confirm` }]);
    tx.delete(assessmentTargets).where(eq(assessmentTargets.repositorySourceId, source.id)).run();
    const now = new Date();
    return {
      previews: deleteRepositoryPreviews(tx, source.id),
      deleted: updateLocked(tx, repositorySources, source, { deletedAt: now, updatedAt: now }, `${source.name} was changed while it was being deleted`),
    };
  });
  // The previews stopped serving with the commit; their directories move aside now and are removed in the background.
  void discardPreviewFiles(getConfig(), previews);
  return deleted;
}

/** How many Runs of Assessments included each source, keyed by source row id. */
export function runCounts(db: Executor): Map<number, number> {
  const rows = db
    .select({ sourceId: runTargets.repositorySourceId, count: sql<number>`count(distinct ${runTargets.runId})` })
    .from(runTargets)
    .groupBy(runTargets.repositorySourceId)
    .all();
  // Template targets have no source.
  return new Map(rows.flatMap((row) => (row.sourceId === null ? [] : [[row.sourceId, row.count] as const])));
}

/** Resolves the URL, or throws every URL and field problem together. */
function resolveOrReject(form: SourceForm, boundary?: SourceBoundary): ResolvedUrl {
  let urlIssue: Issue | null = null;
  let url: ResolvedUrl | null = null;
  try {
    url = resolveCloneUrl(form.cloneUrl, boundary);
  } catch (error) {
    if (!(error instanceof InvalidCloneUrl || error instanceof BoundaryViolation)) throw error;
    urlIssue = { field: "cloneUrl", message: error.message };
  }
  if (!url) throw new ValidationError([urlIssue!, ...sourceFieldIssues(form)]);
  return url;
}
