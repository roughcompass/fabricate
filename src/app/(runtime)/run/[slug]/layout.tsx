import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { PortalRuntime } from "@/demo/runtime/portal-runtime";
import { RuntimeToolbar } from "@/demo/runtime/runtime-toolbar";
import { applicationsAvailable } from "@/lib/applications/availability";
import { findApplication } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";
import { type DemoView, resolveView } from "@/lib/demo/access";
import { BRANDS, referenceTemplate } from "@/lib/demo/catalog";
import { demoEnabled } from "@/lib/demo/guard";
import { listProfiles } from "@/lib/demo/profiles";
import { currentWorkspace } from "@/lib/demo/request";
import { runtimeExperience } from "@/lib/demo/runtime-experience";
import { runtimeDescriptor, shareCookieName } from "@/lib/demo/runtime-view";
import type { Workspace } from "@/lib/demo/workspaces";

/** Whether +slug+ is a template's reference deployment, which the template demo runs here until it's removed (add-applications, task group 10). */
function isReference(slug: string): boolean {
  return demoEnabled() && referenceTemplate(slug) !== undefined;
}

async function resolve(applicationId: string): Promise<{ view: DemoView; workspace: Workspace | null; token: string | null } | null> {
  const workspace = await currentWorkspace();
  const token = (await cookies()).get(shareCookieName(applicationId))?.value ?? null;
  const db = getDb();
  // A remembered share link opens the sharer's view; otherwise the visitor's own.
  const shared = token ? resolveView(db, applicationId, workspace, token) : null;
  const view = shared ?? resolveView(db, applicationId, workspace, null);
  return view ? { view, workspace, token: shared ? token : null } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (isReference(slug)) {
    const resolved = await resolve(slug);
    if (!resolved) return { title: "Page not found" };
    const { template } = resolved.view;
    // The portal's own favicon: never the Frontend Registry's.
    return { title: { absolute: `${template.title} · ${BRANDS[template.brand].portalName}` }, icons: { icon: [{ url: runtimeExperience(template.brand).favicon }] } };
  }
  if (!applicationsAvailable()) return {};
  const application = findApplication(getDb(), slug);
  return application ? { title: application.name } : { title: "Page not found" };
}

/**
 * A running application (add-applications, design decision 5): its page
 * renders the application's current build in a frame under the toolbar. The
 * template demo's reference deployments still run here, in their portal
 * shell, until the demo is removed; this layout keeps that runtime across
 * their routes, so its client state survives navigation.
 */
export default async function RunLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isReference(slug)) return children;
  const resolved = await resolve(slug);
  // The visitor's own profiles, whoever's view this is: a share link never carries the sharer's.
  const profiles = resolved?.workspace ? listProfiles(getDb(), resolved.workspace.id) : [];
  const descriptor = resolved && runtimeDescriptor(resolved.view, resolved.workspace, resolved.token, profiles);
  if (!descriptor) notFound();
  return (
    <PortalRuntime descriptor={descriptor}>
      {children}
      <RuntimeToolbar />
    </PortalRuntime>
  );
}
