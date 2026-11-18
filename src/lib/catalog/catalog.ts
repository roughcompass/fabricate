import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { type Issue, ValidationError } from "@/lib/db/errors";
import { requestCancellation } from "@/lib/assessments/transitions";
import { type ProfileTrigger, assessmentTargets, assessments, initiativeTargets, initiatives, repositorySources } from "@/lib/db/schema";
import { CloneUrl, InvalidCloneUrl } from "./clone-url";
import { repositoryNameFromUrl } from "./repository-name";
import { BoundaryViolation, SourceBoundary } from "./source-boundary";
import { isActive, queueProfile, versionCount, versionsOf } from "@/lib/profiling/versions";
import { type RepositorySource, getSource, insertSource, sourceFieldIssues, updateSource } from "./source-records";

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

export function registerSource(db: Executor, submitted: SourceForm, boundary?: SourceBoundary, trigger: Extract<ProfileTrigger, "added" | "imported"> = "added"): RepositorySource {
  const form = named(submitted);
  const url = resolveOrReject(form, boundary);
  return immediate(db, (tx) => {
    const source = insertSource(tx, { name: form.name, gitRef: form.gitRef, ...url });
    queueProfile(tx, source, trigger);
    return source;
  });
}

export function editSource(db: Executor, publicId: string, lockVersion: number, submitted: SourceForm, boundary?: SourceBoundary): RepositorySource {
  const form = named(submitted);
  const url = resolveOrReject(form, boundary);
  return immediate(db, (tx) => {
    const before = getSource(tx, publicId);
    const source = updateSource(tx, publicId, lockVersion, { name: form.name, gitRef: form.gitRef, ...url });
    if (source.canonicalUrl !== before.canonicalUrl || source.gitRef !== before.gitRef) queueProfile(tx, source, "edited");
    return source;
  });
}

export interface DeletionEffects {
  /** Its profile versions, which go with it. */
  readonly versions: number;
  /** Assessments that select it, which stop selecting it. */
  readonly assessments: readonly string[];
  /** Runs of Assessments that included it, whose results stay. */
  readonly runs: number;
}

/** What deleting +source+ changes, for the confirmation to state. */
export function deletionEffects(db: Executor, source: RepositorySource): DeletionEffects {
  const selecting = db
    .select({ name: initiatives.name })
    .from(initiativeTargets)
    .innerJoin(initiatives, eq(initiatives.id, initiativeTargets.initiativeId))
    .where(and(eq(initiativeTargets.repositorySourceId, source.id), isNull(initiatives.claimRepositorySourceId)))
    .orderBy(sql`lower(${initiatives.name})`)
    .all();
  return { versions: versionCount(db, source.id), assessments: selecting.map((row) => row.name), runs: assessmentCounts(db).get(source.id) ?? 0 };
}

/**
 * Deletes +source+ from the catalog, permanently, once +confirmation+ is its
 * name exactly. It leaves every list, scope, profiling check, and claim, and
 * its clone URL is free to register again. A profile version in progress is
 * canceled, and Assessments that select it stop selecting it; the Assessment
 * created for its claim keeps it, so its history reads true. Past Runs keep
 * their results, which name it as they assessed it.
 */
export function deleteSource(db: Executor, publicId: string, confirmation: string): RepositorySource {
  return immediate(db, (tx) => {
    const source = getSource(tx, publicId);
    if (confirmation.trim() !== source.name) throw new ValidationError([{ field: "confirmation", message: `Type ${source.name} to confirm` }]);
    for (const version of versionsOf(tx, source.id).filter(isActive)) requestCancellation(tx, version.assessment.id);
    const operatorInitiatives = tx.select({ id: initiatives.id }).from(initiatives).where(isNull(initiatives.claimRepositorySourceId));
    tx.delete(initiativeTargets).where(and(eq(initiativeTargets.repositorySourceId, source.id), inArray(initiativeTargets.initiativeId, operatorInitiatives))).run();
    const now = new Date();
    return tx
      .update(repositorySources)
      .set({ deletedAt: now, updatedAt: now, lockVersion: source.lockVersion + 1 })
      .where(eq(repositorySources.id, source.id))
      .returning()
      .get();
  });
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
