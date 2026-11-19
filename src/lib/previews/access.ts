import { eq } from "drizzle-orm";
import type { Repository } from "@/lib/repositories/repository-records";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { previewBuilds, previewEnrollments, repositories } from "@/lib/db/schema";

/**
 * Whether previews are on and a Repository's remote is enrolled for them
 * (spec: "Previews are off unless enabled", "Only enrolled remotes can be
 * previewed"). Enrollment is by canonical remote identity, never by name or
 * id: adding a Repository, or its availability for assessment, enrolls
 * nothing, and the check is repeated wherever queued work could outlive it.
 * A remote is enrolled by `previews.trustedSources`, or by an application
 * created from it after the operator confirmed they trust its code.
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

/**
 * Whether previews are on and +repository+'s remote is enrolled: listed in
 * `previews.trustedSources`, or enrolled by creating an application from it
 * (add-applications), by canonical remote identity either way.
 */
export function isEnrolled(db: Executor, config: FrontendRegistryConfig, repository: Pick<Repository, "canonicalUrl" | "deletedAt">): boolean {
  if (!config.previews.enabled || repository.deletedAt !== null) return false;
  return config.previews.trustedSources.includes(repository.canonicalUrl) || findEnrollment(db, repository.canonicalUrl) !== undefined;
}

/** Throws unless previews are on and +repository+ is enrolled. */
export function assertEnrolled(db: Executor, config: FrontendRegistryConfig, repository: Pick<Repository, "name" | "canonicalUrl" | "deletedAt">): void {
  if (!config.previews.enabled) throw new PreviewAccessError("disabled", "Previews are turned off");
  if (!isEnrolled(db, config, repository)) throw new PreviewAccessError("not_enrolled", `${repository.name} is not enrolled for previews`);
}

export type PreviewEnrollment = typeof previewEnrollments.$inferSelect;

/** The enrollment an application recorded for the remote +canonicalUrl+, if any. */
export function findEnrollment(db: Executor, canonicalUrl: string): PreviewEnrollment | undefined {
  return db.select().from(previewEnrollments).where(eq(previewEnrollments.canonicalUrl, canonicalUrl)).get();
}

/**
 * Enrolls +repository+'s remote for previews on behalf of +application+,
 * after the operator confirmed they trust its code, unless it's enrolled
 * already. Deleting the application, or every application of the remote,
 * leaves the enrollment. Returns whether this enrolled it.
 */
export function enrollRemote(db: Executor, repository: Pick<Repository, "canonicalUrl">, application: { publicId: string; name: string }, now = new Date()): boolean {
  const inserted = db
    .insert(previewEnrollments)
    .values({ canonicalUrl: repository.canonicalUrl, applicationPublicId: application.publicId, applicationName: application.name, createdAt: now })
    .onConflictDoNothing({ target: previewEnrollments.canonicalUrl })
    .returning()
    .get();
  return inserted !== undefined;
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
  return repository && isEnrolled(db, config, repository) ? { preview, repository } : null;
}
