import type { RuntimeDescriptor } from "@/demo/runtime/descriptor";
import { type DemoView, viewApplicationId, viewTemplate } from "./access";
import { DEMO_DOMAIN, applicationUrl } from "./deployments";
import type { Workspace } from "./workspaces";

/** The cookie that remembers a share link's token for one application (design.md, decision 11). */
export function shareCookieName(applicationId: string): string {
  return `fabricate_demo_view_${applicationId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

/** What the browser needs to run a view, or null when the view's template no longer exists. */
export function runtimeDescriptor(view: DemoView, visitor: Workspace | null, shareToken: string | null): RuntimeDescriptor | null {
  const template = viewTemplate(view.target);
  if (!template) return null;
  const applicationId = viewApplicationId(view.target);
  const application = view.target.kind === "application" ? view.target.application : null;
  return {
    applicationId,
    applicationName: application?.name ?? template.title,
    templateSlug: template.slug,
    environment: application?.environment ?? "production",
    access: view.access,
    viewKey: `${applicationId}:${view.viewWorkspaceId ?? "anonymous"}:${visitor?.resetEpoch ?? 0}`,
    shareState: view.access === "share" ? (view.shareState ?? null) : null,
    shareToken: view.access === "share" ? shareToken : null,
    displayName: visitor?.displayName ?? null,
    hints: visitor?.hints ?? {},
    url: application ? applicationUrl(application) : `https://${template.slug}-preview.${DEMO_DOMAIN}`,
  };
}
