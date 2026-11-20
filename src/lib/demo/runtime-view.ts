import type { RuntimeDescriptor } from "@/demo/runtime/descriptor";
import { type Template, referenceId } from "./catalog";
import { referenceUrl } from "./deployments";
import { runtimeExperience } from "./runtime-experience";
import type { Workspace } from "./workspaces";

/**
 * What the browser needs to run a template's reference deployment, for
 * +visitor+. Share links and session profiles belong to applications now
 * (add-applications), so a reference deployment has neither until the demo
 * is removed.
 */
export function runtimeDescriptor(template: Template, visitor: Workspace | null, now = Date.now()): RuntimeDescriptor {
  const { shell, experience } = runtimeExperience(template.brand, new Date(now));
  const applicationId = referenceId(template.slug);
  return {
    applicationId,
    applicationName: template.title,
    templateSlug: template.slug,
    environment: "production",
    access: "reference",
    viewKey: `${applicationId}:${visitor?.id ?? "anonymous"}:${visitor?.resetEpoch ?? 0}`,
    shareState: null,
    shareToken: null,
    displayName: visitor?.displayName ?? null,
    hints: visitor?.hints ?? {},
    profiles: [],
    url: referenceUrl(template.slug),
    pageHref: `/templates/${template.slug}`,
    shell,
    experience,
  };
}
