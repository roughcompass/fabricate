import type { RuntimeDescriptor } from "@/demo/runtime/descriptor";
import type { DemoView } from "./access";
import { type Profile, referenceId } from "./catalog";
import { referenceUrl } from "./deployments";
import { runtimeExperience } from "./runtime-experience";
import type { Workspace } from "./workspaces";

/** The cookie that remembers a share link's token for one application (design.md, decision 11). */
export function shareCookieName(applicationId: string): string {
  return `fabricate_demo_view_${applicationId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

/**
 * What the browser needs to run a view. `profiles` are the visiting
 * workspace's own session profiles.
 */
export function runtimeDescriptor(view: DemoView, visitor: Workspace | null, shareToken: string | null, profiles: readonly Profile[] = [], now = Date.now()): RuntimeDescriptor {
  const { template } = view;
  const { shell, experience } = runtimeExperience(template.brand, new Date(now));
  const applicationId = referenceId(template.slug);
  return {
    applicationId,
    applicationName: template.title,
    templateSlug: template.slug,
    environment: "production",
    access: view.access,
    viewKey: `${applicationId}:${view.viewWorkspaceId ?? "anonymous"}:${visitor?.resetEpoch ?? 0}`,
    shareState: view.access === "share" ? (view.shareState ?? null) : null,
    shareToken: view.access === "share" ? shareToken : null,
    displayName: visitor?.displayName ?? null,
    hints: visitor?.hints ?? {},
    profiles,
    url: referenceUrl(template.slug),
    pageHref: `/templates/${template.slug}`,
    shell,
    experience,
  };
}
