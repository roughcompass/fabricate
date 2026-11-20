import { and, eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { JOB_PRIORITIES, applicationPreviews, applications } from "@/lib/db/schema";
import { type PreviewBuild, type PreviewPreparation, preparationPriority } from "@/lib/previews/records";
import { NO_PAGE_REASON } from "@/lib/previews/output";
import { requestScreenshot } from "@/lib/previews/screenshots";
import { failPreparationHistory, settleBuildHistory, startRebuildHistory } from "./history";
import { applicationTarget, savedTarget, startPackageBuild } from "./pipeline";
import { type ApplicationReason, type SettleValues, settleApplications, waitingOnPreparation } from "./records";
import { savedWaitingOnPreparation, settleSavedPreviews } from "./saved-previews";

/**
 * How applications and their saved previews follow their builds through the
 * preview pipeline (add-applications, design decision 2;
 * restore-toolbar-tools-and-branch-previews, design decision 2). The
 * pipeline's records call these as its preparations and attempts change, in
 * the same transaction, so a target's latest outcome never disagrees with
 * its preview. Each settles both kinds of target, applications and saved
 * previews, by their latest preparation or latest build:
 *
 * - a decided preparation starts the build of each waiting target's
 *   package, or records it as not previewable with the conditions it failed;
 * - a preparation that failed fails each waiting target;
 * - an attempt that publishes becomes the current build of the targets
 *   it's the latest attempt of, and their screenshot is requested;
 * - an attempt that fails fails the targets it's the latest attempt of,
 *   leaving their current build as it was, with the last lines of its log;
 *   one whose build ran but emitted no page makes its commit not
 *   previewable, for its page, as a commit refused for its page is;
 * - a rebuild of a target's latest build shows it building again.
 *
 * Only applications' attempts are written to their build history.
 */

/** Settles the applications and saved previews whose latest build is +previewId+ and that +building+ (when given) still are. */
function settleUsersOf(db: Executor, previewId: number, values: SettleValues, building = false): void {
  settleApplications(db, and(eq(applications.latestPreviewId, previewId), building ? eq(applications.latestOutcome, "building") : undefined), values);
  settleSavedPreviews(db, and(eq(applicationPreviews.latestPreviewId, previewId), building ? eq(applicationPreviews.latestOutcome, "building") : undefined), values);
}

/** A preparation was decided: each target waiting on it starts its package's build, or is refused; a saved preview's at the preparation's priority. */
export function afterPreparationDecided(db: Executor, preparation: PreviewPreparation): void {
  for (const application of db.select().from(applications).where(waitingOnPreparation(preparation.id)).all()) startPackageBuild(db, applicationTarget(application), preparation);
  const saved = db.select().from(applicationPreviews).where(savedWaitingOnPreparation(preparation.id)).all();
  if (saved.length === 0) return;
  const priority = preparationPriority(db, preparation);
  for (const row of saved) startPackageBuild(db, savedTarget(db, row), preparation, { priority });
}

/** A preparation failed before deciding: each target waiting on it failed with its reason. */
export function afterPreparationFailed(db: Executor, preparation: PreviewPreparation): void {
  const reasons = [{ text: preparation.failure ?? "The commit couldn't be prepared." }];
  settleApplications(db, waitingOnPreparation(preparation.id), { outcome: "failed", reasons });
  settleSavedPreviews(db, savedWaitingOnPreparation(preparation.id), { outcome: "failed", reasons });
  failPreparationHistory(db, preparation.id, reasons);
}

/**
 * An attempt published: it's the current build of each target it's the
 * latest attempt of, and their screenshot is taken, at background priority
 * when only saved previews show it.
 */
export function afterAttemptPublished(db: Executor, preview: PreviewBuild): void {
  settleUsersOf(db, preview.id, { outcome: "ready", reasons: null, current: preview.id });
  settleBuildHistory(db, preview, "ready", null);
  // A rebuild of a current build, even one a target no longer tries, replaces what its screenshot shows.
  const application = db.select({ id: applications.id }).from(applications).where(eq(applications.currentPreviewId, preview.id)).get();
  if (application) {
    requestScreenshot(db, preview);
    return;
  }
  const saved = db.select({ id: applicationPreviews.id }).from(applicationPreviews).where(eq(applicationPreviews.currentPreviewId, preview.id)).get();
  if (saved) requestScreenshot(db, preview, JOB_PRIORITIES.background);
}

/** An attempt failed: each target it's the latest attempt of failed, or can't be previewed when its build emitted no page, keeping its current build. */
export function afterAttemptFailed(db: Executor, preview: PreviewBuild, detail: readonly string[] = []): void {
  const noPage = preview.attemptReason === NO_PAGE_REASON;
  const outcome = noPage ? "not_previewable" : "failed";
  const reasons: ApplicationReason[] = noPage ? [{ text: NO_PAGE_REASON, condition: "page" }] : [{ text: preview.attemptReason ?? "The build failed.", ...(detail.length > 0 && { log: [...detail] }) }];
  settleUsersOf(db, preview.id, { outcome, reasons }, true);
  settleBuildHistory(db, preview, outcome, reasons);
}

/** An attempt was queued for a preview that's a target's latest attempt: it's building again. */
export function afterRebuildQueued(db: Executor, preview: PreviewBuild): void {
  for (const application of db.select().from(applications).where(eq(applications.latestPreviewId, preview.id)).all()) startRebuildHistory(db, application, preview);
  settleUsersOf(db, preview.id, { outcome: "building", reasons: null });
}
