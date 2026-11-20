import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Application, ApplicationBuild } from "@/lib/applications/records";
import { type SavedPreview, findSavedPreview, refLabel } from "@/lib/applications/saved-previews";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { applicationPreviews, applications, previewBuilds } from "@/lib/db/schema";
import { openPreview } from "@/lib/previews/access";
import { type Share, findShare } from "./shares";
import type { Workspace } from "./workspaces";

/**
 * Who may see which view of a running application (template-demo/demo-mode
 * spec; add-applications, design decision 7). A view is an application
 * together with the workspace whose comments it shows: the visiting
 * workspace, or the sharer's workspace for a share link. Applications
 * themselves are shared by every workspace.
 */

/** The application a view is of: its row id, public id, and slug. */
export interface ViewedApplication {
  readonly id: number;
  readonly publicId: string;
  readonly slug: string;
}

/** The saved preview a view shows (restore-toolbar-tools-and-branch-previews, design decision 5): its row id, key, and ref. */
export interface ViewedPreview {
  readonly id: number;
  readonly key: string;
  readonly ref: string;
}

export interface ApplicationView {
  readonly application: ViewedApplication;
  /** Null for a visitor who hasn't written anything yet, whose workspace doesn't exist. */
  readonly viewWorkspaceId: number | null;
  readonly access: "own" | "share";
  /** The share link the view was opened through. */
  readonly share?: Share;
  /** The saved preview shown; absent for the tracked branch. New threads and share links record it. */
  readonly preview?: ViewedPreview;
}

const viewedColumns = { id: applications.id, publicId: applications.publicId, slug: applications.slug };

/** The application at /run/<slug>, or null. */
export function viewedApplication(db: Executor, slug: string): ViewedApplication | null {
  return db.select(viewedColumns).from(applications).where(eq(applications.slug, slug)).get() ?? null;
}

/** The application +share+ links to. Deleting an application deletes its share links, so it's there while the link is. */
export function sharedApplication(db: Executor, share: Pick<Share, "applicationId">): ViewedApplication | null {
  return db.select(viewedColumns).from(applications).where(eq(applications.id, share.applicationId)).get() ?? null;
}

/** The application's saved preview with +key+, as a view names it, or null. */
export function viewedPreview(db: Executor, application: ViewedApplication, key: string): ViewedPreview | null {
  return db.select({ id: applicationPreviews.id, key: applicationPreviews.key, ref: applicationPreviews.ref }).from(applicationPreviews).where(and(eq(applicationPreviews.applicationId, application.id), eq(applicationPreviews.key, key))).get() ?? null;
}

/**
 * The view of +application+ a visitor may open: the shared view when
 * +shareToken+ is a link to this application, otherwise their own. A token
 * for another application, or one that no longer resolves, grants nothing,
 * so the visitor sees their own view. +preview+ is the saved preview shown,
 * if any, which new threads and share links record.
 */
export function resolveApplicationView(db: Executor, application: ViewedApplication, visitor: Workspace | null, shareToken?: string | null, preview?: ViewedPreview | null): ApplicationView {
  const share = shareToken ? findShare(db, shareToken) : null;
  const shown = preview ? { preview } : {};
  if (share && share.applicationId === application.id) return { application, viewWorkspaceId: share.viewWorkspaceId, access: "share", share, ...shown };
  return { application, viewWorkspaceId: visitor?.id ?? null, access: "own", ...shown };
}

/**
 * The build of +application+ at +commit+ that a share link captured, when
 * it's still served: a preview of the application's Repository and package
 * at that commit, undeleted and published. Null once it was pruned or
 * deleted, so the link opens the current build instead (template-demo/
 * toolbar spec, "Shared links open the captured view").
 */
export function sharedBuild(db: Executor, config: FrontendRegistryConfig, application: ViewedApplication, commit: string): { readonly preview: string; readonly commitSha: string } | null {
  const row = db
    .select({ publicId: previewBuilds.publicId })
    .from(previewBuilds)
    .innerJoin(applications, and(eq(applications.repositoryId, previewBuilds.repositoryId), eq(applications.packageDir, previewBuilds.packageDir)))
    .where(and(eq(applications.id, application.id), eq(previewBuilds.commitSha, commit), isNull(previewBuilds.deletedAt), isNotNull(previewBuilds.artifact)))
    .orderBy(desc(previewBuilds.id))
    .get();
  return row && openPreview(db, config, row.publicId) ? { preview: row.publicId, commitSha: commit } : null;
}

/** What a share link opens: the saved preview it shows, if it still does, the build, and a notice when either isn't what was shared. */
export interface SharedView {
  readonly saved: SavedPreview | null;
  readonly build: Pick<ApplicationBuild, "preview" | "commitSha">;
  readonly notice: string | null;
}

/**
 * Which build a share link opens (restore-toolbar-tools-and-branch-previews,
 * design decision 5; template-demo/toolbar spec, "Shared links open the
 * captured view"), by these rules in order:
 *
 * 1. a link to a saved preview that was removed opens the application's
 *    current build, saying the shared preview was removed;
 * 2. the captured commit's build of the package, when it's still served;
 * 3. otherwise the saved preview's current build, or the application's for
 *    the tracked branch, saying the shared commit is no longer available.
 *
 * Null when there's nothing to open: the application, or the saved preview,
 * has no successful build.
 */
export function openSharedView(db: Executor, config: FrontendRegistryConfig, application: Pick<Application, "publicId" | "current">, viewed: ViewedApplication, share: Share): SharedView | null {
  if (share.preview && share.preview.id === null) {
    if (!application.current) return null;
    return { saved: null, build: application.current, notice: `The shared preview of ${refLabel(share.preview.ref)} was removed, so this is the application's current build.` };
  }
  const saved = share.preview?.key ? (findSavedPreview(db, application.publicId, share.preview.key) ?? null) : null;
  const current = saved ? saved.current : application.current;
  if (!current) return null;
  if (current.commitSha === share.commit) return { saved, build: current, notice: null };
  const captured = sharedBuild(db, config, viewed, share.commit);
  if (captured) return { saved, build: captured, notice: null };
  const whose = saved ? `${saved.label}'s current build` : "the current build";
  return { saved, build: current, notice: `The shared commit ${share.commit.slice(0, 12)} is no longer available, so this is ${whose}.` };
}
