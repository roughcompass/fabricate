import { sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { type Issue, ValidationError } from "@/lib/db/errors";
import { assessmentTargets } from "@/lib/db/schema";
import { CloneUrl, InvalidCloneUrl } from "./clone-url";
import { BoundaryViolation, SourceBoundary } from "./source-boundary";
import { type RepositorySource, insertSource, setSourceEnabled, sourceFieldIssues, updateSource } from "./source-records";

/**
 * Catalog operations for the web UI: parse and canonicalize the clone URL,
 * confine local paths to the source boundary, then persist. Every problem is
 * reported at once, addressed to its field, and nothing is written unless the
 * whole submission is valid.
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
  return insertSource(db, { name: form.name, gitRef: form.gitRef, ...url });
}

export function editSource(db: Executor, publicId: string, lockVersion: number, form: SourceForm, boundary?: SourceBoundary): RepositorySource {
  const url = resolveOrReject(form, boundary);
  return updateSource(db, publicId, lockVersion, { name: form.name, gitRef: form.gitRef, ...url });
}

export function enableSource(db: Executor, publicId: string): RepositorySource {
  return setSourceEnabled(db, publicId, true);
}

export function disableSource(db: Executor, publicId: string): RepositorySource {
  return setSourceEnabled(db, publicId, false);
}

/** How many Assessments included each source, keyed by source row id. */
export function assessmentCounts(db: Executor): Map<number, number> {
  const rows = db
    .select({ sourceId: assessmentTargets.repositorySourceId, count: sql<number>`count(distinct ${assessmentTargets.assessmentId})` })
    .from(assessmentTargets)
    .groupBy(assessmentTargets.repositorySourceId)
    .all();
  return new Map(rows.map((row) => [row.sourceId, row.count]));
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
