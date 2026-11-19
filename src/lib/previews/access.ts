import { eq } from "drizzle-orm";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { previewBuilds, repositorySources } from "@/lib/db/schema";

/**
 * Whether previews are on and a Repository's remote is enrolled for them
 * (spec: "Previews are off unless enabled", "Only enrolled remotes can be
 * previewed"). Enrollment is by canonical remote identity, never by name or
 * id: adding a Repository, or its availability for assessment, enrolls
 * nothing, and the check is repeated wherever queued work could outlive it.
 */

export class PreviewAccessError extends Error {
  override name = "PreviewAccessError";

  constructor(
    readonly code: "disabled" | "not_enrolled",
    message: string,
  ) {
    super(message);
  }
}

export function isEnrolled(config: FrontendRegistryConfig, source: Pick<RepositorySource, "canonicalUrl" | "deletedAt">): boolean {
  return config.previews.enabled && source.deletedAt === null && config.previews.trustedSources.includes(source.canonicalUrl);
}

/** Throws unless previews are on and +source+ is enrolled. */
export function assertEnrolled(config: FrontendRegistryConfig, source: Pick<RepositorySource, "name" | "canonicalUrl" | "deletedAt">): void {
  if (!config.previews.enabled) throw new PreviewAccessError("disabled", "Previews are turned off");
  if (!isEnrolled(config, source)) throw new PreviewAccessError("not_enrolled", `${source.name} is not enrolled for previews`);
}

/** A preview that may be shown, with its Repository. */
export interface OpenPreview {
  readonly preview: typeof previewBuilds.$inferSelect;
  readonly source: RepositorySource;
}

/**
 * The one gate for showing a preview: its files, its page, and its log. It
 * opens only while previews are on, the preview exists and isn't deleted, and
 * its Repository exists and its remote is enrolled; otherwise null, which
 * every caller answers as not found, the same for each reason.
 */
export function openPreview(db: Executor, config: FrontendRegistryConfig, publicId: string): OpenPreview | null {
  if (!config.previews.enabled || !isPublicId(publicId, "pvw")) return null;
  const preview = db.select().from(previewBuilds).where(eq(previewBuilds.publicId, publicId)).get();
  if (!preview || preview.deletedAt !== null) return null;
  const source = db.select().from(repositorySources).where(eq(repositorySources.id, preview.repositorySourceId)).get();
  return source && isEnrolled(config, source) ? { preview, source } : null;
}
