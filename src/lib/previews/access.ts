import { eq } from "drizzle-orm";
import type { Repository } from "@/lib/repositories/repository-records";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { previewBuilds, repositories } from "@/lib/db/schema";

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

export function isEnrolled(config: FrontendRegistryConfig, repository: Pick<Repository, "canonicalUrl" | "deletedAt">): boolean {
  return config.previews.enabled && repository.deletedAt === null && config.previews.trustedSources.includes(repository.canonicalUrl);
}

/** Throws unless previews are on and +repository+ is enrolled. */
export function assertEnrolled(config: FrontendRegistryConfig, repository: Pick<Repository, "name" | "canonicalUrl" | "deletedAt">): void {
  if (!config.previews.enabled) throw new PreviewAccessError("disabled", "Previews are turned off");
  if (!isEnrolled(config, repository)) throw new PreviewAccessError("not_enrolled", `${repository.name} is not enrolled for previews`);
}

/** A preview that may be shown, with its Repository. */
export interface OpenPreview {
  readonly preview: typeof previewBuilds.$inferSelect;
  readonly repository: Repository;
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
  const repository = db.select().from(repositories).where(eq(repositories.id, preview.repositoryId)).get();
  return repository && isEnrolled(config, repository) ? { preview, repository } : null;
}
