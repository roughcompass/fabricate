import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { previewBuilds, previewPreparations } from "@/lib/db/schema";
import { type PreviewBuild, type PreviewPreparation, settleAbandonedAttempts, settleAbandonedPreparations } from "./records";
import { type RefListing, listRemoteRefs } from "./refs";
import { statusVersion } from "@/lib/assessments/status";

/**
 * What the Repository page and the preview page read about previews (spec
 * "Preview states and logs are visible"): a Repository's previews newest
 * first, the preparation the operator asked for, the previews of its
 * packages, and a version that changes whenever any of that does, which the
 * page polls while work is under way.
 */

/** The Repository's undeleted previews, newest first, +limit+ from +offset+. */
export function listPreviews(db: Executor, source: Pick<RepositorySource, "id">, options: { limit: number; offset?: number }): PreviewBuild[] {
  return db
    .select()
    .from(previewBuilds)
    .where(and(eq(previewBuilds.repositorySourceId, source.id), isNull(previewBuilds.deletedAt)))
    .orderBy(desc(previewBuilds.createdAt), desc(previewBuilds.id))
    .limit(options.limit)
    .offset(options.offset ?? 0)
    .all();
}

export function previewCount(db: Executor, source: Pick<RepositorySource, "id">): number {
  return db.select({ count: count() }).from(previewBuilds).where(and(eq(previewBuilds.repositorySourceId, source.id), isNull(previewBuilds.deletedAt))).get()?.count ?? 0;
}

/** The preparation +publicId+ of +source+, or undefined for one of another Repository or none. */
export function preparationOf(db: Executor, source: Pick<RepositorySource, "id">, publicId: string | undefined): PreviewPreparation | undefined {
  if (!isPublicId(publicId, "ppr")) return undefined;
  return db
    .select()
    .from(previewPreparations)
    .where(and(eq(previewPreparations.publicId, publicId), eq(previewPreparations.repositorySourceId, source.id)))
    .get();
}

/** The undeleted previews of +preparation+'s commit, by package directory. */
export function previewsOfCommit(db: Executor, preparation: Pick<PreviewPreparation, "repositorySourceId" | "commitSha">): Map<string, PreviewBuild> {
  const rows = db
    .select()
    .from(previewBuilds)
    .where(and(eq(previewBuilds.repositorySourceId, preparation.repositorySourceId), eq(previewBuilds.commitSha, preparation.commitSha), isNull(previewBuilds.deletedAt)))
    .all();
  return new Map(rows.map((row) => [row.packageDir, row]));
}

/** Fails the Repository's preparations and attempts whose jobs can no longer finish them, so a page never shows them under way forever. */
export function settlePreviewWork(db: Executor, publicId?: string): void {
  settleAbandonedPreparations(db);
  settleAbandonedAttempts(db, publicId === undefined ? {} : { publicId });
}

export interface PreviewActivity {
  /** Changes whenever the preparation or any of the Repository's previews changes state. */
  readonly version: string;
  /** Whether the preparation is profiling or any preview's latest attempt is queued or building. */
  readonly active: boolean;
}

/** The state of the Repository's preview work, which its page polls while +active+. */
export function previewActivity(db: Executor, source: Pick<RepositorySource, "id">, preparationPublicId?: string): PreviewActivity {
  const preparation = preparationOf(db, source, preparationPublicId);
  const previews = db
    .select({ publicId: previewBuilds.publicId, attempt: previewBuilds.attempt, state: previewBuilds.attemptState, artifact: previewBuilds.artifactAttempt })
    .from(previewBuilds)
    .where(and(eq(previewBuilds.repositorySourceId, source.id), isNull(previewBuilds.deletedAt)))
    .orderBy(previewBuilds.id)
    .all();
  const parts = [preparation ? `${preparation.publicId}:${preparation.state}:${preparation.requestedAt.getTime()}` : "-", ...previews.map((row) => `${row.publicId}:${row.attempt}:${row.state}:${row.artifact ?? 0}`)];
  return {
    version: statusVersion(parts),
    active: preparation?.state === "profiling" || previews.some((row) => row.state === "queued" || row.state === "building"),
  };
}

/** How long a Repository's listed refs are reused, so a page that refreshes while work runs doesn't ask the remote each time. */
const REFS_TTL_MS = 30_000;
const listings = new Map<string, { at: number; listing: Promise<RefListing> }>();

/**
 * The remote's branches and tags for the Repository page, read live but
 * reused for half a minute per Repository, remote, and reference. A listing
 * that failed is never reused.
 */
export function remoteRefsFor(config: FrontendRegistryConfig, source: Pick<RepositorySource, "publicId" | "cloneUrl" | "gitRef">, now = Date.now()): Promise<RefListing> {
  const key = `${source.publicId}\n${source.cloneUrl}\n${source.gitRef ?? ""}`;
  const cached = listings.get(key);
  if (cached && now - cached.at < REFS_TTL_MS) return cached.listing;
  for (const [stale, entry] of listings) if (now - entry.at >= REFS_TTL_MS) listings.delete(stale);
  const listing: Promise<RefListing> = listRemoteRefs(source, { config }).then((result) => {
    if (result.unavailable !== null && listings.get(key)?.listing === listing) listings.delete(key);
    return result;
  });
  listings.set(key, { at: now, listing });
  return listing;
}

/** A ref as the operator chose it: a branch or tag by its name, or null for a commit chosen by SHA. */
export function refLabel(row: Pick<PreviewBuild, "refName" | "refKind">): string | null {
  if (row.refName === null) return null;
  return row.refName.replace(row.refKind === "tag" ? /^refs\/tags\// : /^refs\/heads\//, "");
}

/** A preview's package as people know it: its manifest's name, else its directory. */
export function packageLabel(preview: Pick<PreviewBuild, "packageDir" | "decidingFacts">): string {
  try {
    const name = preview.decidingFacts.name;
    if (typeof name === "string" && name !== "") return name;
  } catch {
    // A verdict that can't be read still has its directory.
  }
  return preview.packageDir === "." ? "The repository root" : preview.packageDir;
}

/** A preview by public id, deleted or not, for saying what was deleted. */
export function findPreviewIncludingDeleted(db: Executor, publicId: string): PreviewBuild | undefined {
  return isPublicId(publicId, "pvw") ? db.select().from(previewBuilds).where(eq(previewBuilds.publicId, publicId)).get() : undefined;
}
