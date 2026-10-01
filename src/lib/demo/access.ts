import type { Executor } from "@/lib/db/client";
import { type DemoApplication, findApplication, findApplicationById } from "./applications";
import { type Template, referenceId, referenceTemplate, templateBySlug } from "./catalog";
import { type ShareState, findShare } from "./shares";
import type { Workspace } from "./workspaces";

/**
 * Who may see which view of a running application (design.md, decision 4).
 * A view is an application together with the workspace whose comments it
 * shows: the owner for a visitor's own application, the visiting workspace for
 * a reference deployment, and the sharer's workspace for a share link.
 */

export type ViewTarget = { readonly kind: "application"; readonly application: DemoApplication } | { readonly kind: "reference"; readonly template: Template };

export interface DemoView {
  readonly target: ViewTarget;
  /** Null for a reference deployment seen by a visitor who has not written anything yet. */
  readonly viewWorkspaceId: number | null;
  readonly access: "owner" | "reference" | "share";
  /** The state captured by the share link this view was opened through. */
  readonly shareState?: ShareState;
}

/** The ID the runtime uses for a view's application: a public ID, or ref-<slug>. */
export function viewApplicationId(target: ViewTarget): string {
  return target.kind === "application" ? target.application.publicId : referenceId(target.template.slug);
}

export function viewTemplate(target: ViewTarget): Template | undefined {
  return target.kind === "application" ? templateBySlug(target.application.templateSlug) : target.template;
}

/**
 * Resolves the view a visitor may open, or null when they may not open it.
 * A share token grants the shared view to anyone holding it, but only for the
 * application it was created for.
 */
export function resolveView(db: Executor, applicationId: string, visitor: Workspace | null, shareToken?: string | null): DemoView | null {
  if (shareToken) {
    const share = findShare(db, shareToken);
    if (!share) return null;
    const target = shareTarget(db, share.target);
    if (!target || viewApplicationId(target) !== applicationId) return null;
    return { target, viewWorkspaceId: share.viewWorkspaceId, access: "share", shareState: share.state };
  }

  const template = referenceTemplate(applicationId);
  if (template) return { target: { kind: "reference", template }, viewWorkspaceId: visitor?.id ?? null, access: "reference" };

  const application = findApplication(db, applicationId);
  if (!application || !visitor || application.workspaceId !== visitor.id) return null;
  return { target: { kind: "application", application }, viewWorkspaceId: visitor.id, access: "owner" };
}

function shareTarget(db: Executor, target: { applicationId: number } | { referenceSlug: string }): ViewTarget | null {
  if ("applicationId" in target) {
    const application = findApplicationById(db, target.applicationId);
    return application ? { kind: "application", application } : null;
  }
  const template = templateBySlug(target.referenceSlug);
  return template ? { kind: "reference", template } : null;
}
