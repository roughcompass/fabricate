import { asc, eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { JOB_PRIORITIES, applicationPreviews, applications, previewBuilds } from "@/lib/db/schema";
import { findScreenshot, requestScreenshot } from "@/lib/previews/screenshots";
import { targetDefault } from "./active";
import type { MockSet } from "./model";

/*
 * Capturing again when a default changes (add-mock-sets, design decision 11;
 * applications/builds spec, "A change to the default mock set is captured
 * again"). After any change to an application's defaults or to one of its
 * sets, each current build its tracked branch and saved previews show is
 * compared with the default its target applies now, by set and revision, and
 * captured again where they differ, behind other screenshots. The earlier
 * image stays shown until the new one is captured, and a newer request
 * supersedes an older one still waiting. A build both the application and a
 * saved preview use is captured with the application's default.
 */

/** Requests a capture of each current build of the application +applicationId+ whose default set, or its revision, changed. Returns how many it requested. */
export function recaptureApplication(db: Executor, applicationId: number): number {
  const application = db.select({ current: applications.currentPreviewId }).from(applications).where(eq(applications.id, applicationId)).get();
  if (!application) return 0;
  const targets: { previewId: number | null; build: number }[] = [];
  if (application.current !== null) targets.push({ previewId: null, build: application.current });
  const saved = db.select({ id: applicationPreviews.id, current: applicationPreviews.currentPreviewId }).from(applicationPreviews).where(eq(applicationPreviews.applicationId, applicationId)).all();
  for (const preview of saved) if (preview.current !== null && preview.current !== application.current) targets.push({ previewId: preview.id, build: preview.current });
  let requested = 0;
  for (const target of targets) {
    const build = db.select({ id: previewBuilds.id, publicId: previewBuilds.publicId, artifact: previewBuilds.artifact }).from(previewBuilds).where(eq(previewBuilds.id, target.build)).get();
    if (!build?.artifact) continue;
    const { set } = targetDefault(db, applicationId, target.previewId);
    const before = findScreenshot(db, build.id);
    const after = requestScreenshot(db, build, JOB_PRIORITIES.background, set ? { publicId: set.publicId, revision: set.revision } : null);
    if (before && after && after.requestedAt.getTime() !== before.requestedAt.getTime()) requested++;
  }
  return requested;
}

/**
 * The default set a capture of the build with row ID +previewId+ applies
 * (design decision 11): the application's, when the build is its tracked
 * branch's current build, otherwise the default of the first saved preview
 * that shows it. Visitors' choices never apply. Null for none, and for a
 * repository preview no application shows.
 */
export function defaultForBuild(db: Executor, previewId: number): MockSet | null {
  const application = db.select({ id: applications.id }).from(applications).where(eq(applications.currentPreviewId, previewId)).get();
  if (application) return targetDefault(db, application.id, null).set;
  const saved = db.select({ id: applicationPreviews.id, applicationId: applicationPreviews.applicationId }).from(applicationPreviews).where(eq(applicationPreviews.currentPreviewId, previewId)).orderBy(asc(applicationPreviews.id)).get();
  return saved ? targetDefault(db, saved.applicationId, saved.id).set : null;
}
