import { and, eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { applications } from "@/lib/db/schema";
import type { PreviewBuild, PreviewPreparation } from "@/lib/previews/records";
import { requestScreenshot } from "@/lib/previews/screenshots";
import { failPreparationHistory, settleBuildHistory, startRebuildHistory } from "./history";
import { startPackageBuild } from "./pipeline";
import { settleApplications, waitingOnPreparation } from "./records";

/**
 * How an application follows its builds through the preview pipeline
 * (add-applications, design decision 2). The pipeline's records call these
 * as its preparations and attempts change, in the same transaction, so an
 * application's latest outcome never disagrees with its preview:
 *
 * - a decided preparation starts the build of each waiting application's
 *   package, or records it as not previewable with the conditions it failed;
 * - a preparation that failed fails each waiting application;
 * - an attempt that publishes becomes the current build of the
 *   applications it's the latest attempt of, and their screenshot is
 *   requested;
 * - an attempt that fails fails the applications it's the latest attempt
 *   of, leaving their current build as it was;
 * - a rebuild of an application's latest build shows it building again.
 */

/** A preparation was decided: each application waiting on it starts its package's build, or is refused. */
export function afterPreparationDecided(db: Executor, preparation: PreviewPreparation): void {
  for (const application of db.select().from(applications).where(waitingOnPreparation(preparation.id)).all()) startPackageBuild(db, application, preparation);
}

/** A preparation failed before deciding: each application waiting on it failed with its reason. */
export function afterPreparationFailed(db: Executor, preparation: PreviewPreparation): void {
  const reasons = [{ text: preparation.failure ?? "The commit couldn't be prepared." }];
  settleApplications(db, waitingOnPreparation(preparation.id), { outcome: "failed", reasons });
  failPreparationHistory(db, preparation.id, reasons);
}

/** An attempt published: it's the current build of each application it's the latest attempt of, and their screenshot is taken. */
export function afterAttemptPublished(db: Executor, preview: PreviewBuild): void {
  settleApplications(db, eq(applications.latestPreviewId, preview.id), { outcome: "ready", reasons: null, current: preview.id });
  settleBuildHistory(db, preview, "ready", null);
  // A rebuild of a current build, even one an application no longer tries, replaces what its screenshot shows.
  const current = db.select({ id: applications.id }).from(applications).where(eq(applications.currentPreviewId, preview.id)).get();
  if (current) requestScreenshot(db, preview);
}

/** An attempt failed: each application it's the latest attempt of failed, keeping its current build. */
export function afterAttemptFailed(db: Executor, preview: PreviewBuild): void {
  const reasons = [{ text: preview.attemptReason ?? "The build failed." }];
  settleApplications(db, and(eq(applications.latestPreviewId, preview.id), eq(applications.latestOutcome, "building")), { outcome: "failed", reasons });
  settleBuildHistory(db, preview, "failed", reasons);
}

/** An attempt was queued for a preview that's an application's latest attempt: it's building again. */
export function afterRebuildQueued(db: Executor, preview: PreviewBuild): void {
  for (const application of db.select().from(applications).where(eq(applications.latestPreviewId, preview.id)).all()) startRebuildHistory(db, application, preview);
  settleApplications(db, eq(applications.latestPreviewId, preview.id), { outcome: "building", reasons: null });
}
