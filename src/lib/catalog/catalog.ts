import { eq, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { type Issue, ValidationError } from "@/lib/db/errors";
import { assessmentTargets, assessments, initiatives } from "@/lib/db/schema";
import { CloneUrl, InvalidCloneUrl } from "./clone-url";
import { BoundaryViolation, SourceBoundary } from "./source-boundary";
import { queueProfile, versionsOf } from "@/lib/profiling/versions";
import { type RepositorySource, getSource, insertSource, setSourceEnabled, sourceFieldIssues, updateSource } from "./source-records";

/**
 * Catalog operations for the web UI: parse and canonicalize the clone URL,
 * confine local paths to the source boundary, then persist. Every problem is
 * reported at once, addressed to its field, and nothing is written unless the
 * whole submission is valid.
 *
 * A Repository is profiled whenever what it names changes: when it's added,
 * when its clone URL or reference is edited, and when it's enabled with no
 * profile version yet (docs/profiling.md).
 */

export interface SourceForm {
  name: string;
  cloneUrl: string;
  gitRef: string;
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

export function registerSource(db: Executor, form: SourceForm, boundary?: SourceBoundary): RepositorySource {
  const url = resolveOrReject(form, boundary);
  return immediate(db, (tx) => {
    const source = insertSource(tx, { name: form.name, gitRef: form.gitRef, ...url });
    queueProfile(tx, source, "added");
    return source;
  });
}

export function editSource(db: Executor, publicId: string, lockVersion: number, form: SourceForm, boundary?: SourceBoundary): RepositorySource {
  const url = resolveOrReject(form, boundary);
  return immediate(db, (tx) => {
    const before = getSource(tx, publicId);
    const source = updateSource(tx, publicId, lockVersion, { name: form.name, gitRef: form.gitRef, ...url });
    if (source.canonicalUrl !== before.canonicalUrl || source.gitRef !== before.gitRef) queueProfile(tx, source, "edited");
    return source;
  });
}

export function enableSource(db: Executor, publicId: string): RepositorySource {
  return immediate(db, (tx) => {
    const source = setSourceEnabled(tx, publicId, true);
    // A repository profiled before it was disabled waits for the scheduled check, which queues a version if it's behind.
    if (versionsOf(tx, source.id, 1).length === 0) queueProfile(tx, source, "initial");
    return source;
  });
}

export function disableSource(db: Executor, publicId: string): RepositorySource {
  return setSourceEnabled(db, publicId, false);
}

/** How many Runs of Assessments included each source, keyed by source row id. Profile versions, which the list shows apart, aren't counted. */
export function assessmentCounts(db: Executor): Map<number, number> {
  const rows = db
    .select({ sourceId: assessmentTargets.repositorySourceId, count: sql<number>`count(distinct ${assessmentTargets.assessmentId})` })
    .from(assessmentTargets)
    .innerJoin(assessments, eq(assessments.id, assessmentTargets.assessmentId))
    .innerJoin(initiatives, eq(initiatives.id, assessments.initiativeId))
    .where(eq(initiatives.profiling, false))
    .groupBy(assessmentTargets.repositorySourceId)
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
