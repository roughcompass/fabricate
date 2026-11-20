import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { applications, previewBuilds } from "@/lib/db/schema";
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

export interface ApplicationView {
  readonly application: ViewedApplication;
  /** Null for a visitor who hasn't written anything yet, whose workspace doesn't exist. */
  readonly viewWorkspaceId: number | null;
  readonly access: "own" | "share";
  /** The share link the view was opened through. */
  readonly share?: Share;
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

/**
 * The view of +application+ a visitor may open: the shared view when
 * +shareToken+ is a link to this application, otherwise their own. A token
 * for another application, or one that no longer resolves, grants nothing,
 * so the visitor sees their own view.
 */
export function resolveApplicationView(db: Executor, application: ViewedApplication, visitor: Workspace | null, shareToken?: string | null): ApplicationView {
  const share = shareToken ? findShare(db, shareToken) : null;
  if (share && share.applicationId === application.id) return { application, viewWorkspaceId: share.viewWorkspaceId, access: "share", share };
  return { application, viewWorkspaceId: visitor?.id ?? null, access: "own" };
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
