import type { Executor } from "@/lib/db/client";
import { type Template, referenceId, referenceTemplate, templateBySlug } from "./catalog";
import { type ShareState, findShare } from "./shares";
import type { Workspace } from "./workspaces";

/**
 * Who may see which view of a running reference deployment (design.md,
 * decision 4). A view is a template's reference deployment together with the
 * workspace whose comments it shows: the visiting workspace, or the sharer's
 * workspace for a share link.
 */

export interface DemoView {
  readonly template: Template;
  /** Null for a reference deployment seen by a visitor who has not written anything yet. */
  readonly viewWorkspaceId: number | null;
  readonly access: "reference" | "share";
  /** The state captured by the share link this view was opened through. */
  readonly shareState?: ShareState;
}

/**
 * Resolves the view a visitor may open, or null when they may not open it.
 * A share token grants the shared view to anyone holding it, but only for the
 * reference deployment it was created for.
 */
export function resolveView(db: Executor, applicationId: string, visitor: Workspace | null, shareToken?: string | null): DemoView | null {
  if (shareToken) {
    const share = findShare(db, shareToken);
    const template = share && templateBySlug(share.referenceSlug);
    if (!share || !template || referenceId(template.slug) !== applicationId) return null;
    return { template, viewWorkspaceId: share.viewWorkspaceId, access: "share", shareState: share.state };
  }

  const template = referenceTemplate(applicationId);
  return template ? { template, viewWorkspaceId: visitor?.id ?? null, access: "reference" } : null;
}
