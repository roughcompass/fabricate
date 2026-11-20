import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PortalRuntime } from "@/demo/runtime/portal-runtime";
import { applicationsAvailable } from "@/lib/applications/availability";
import { findApplication } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";
import { BRANDS, referenceTemplate } from "@/lib/demo/catalog";
import { demoEnabled } from "@/lib/demo/guard";
import { currentWorkspace } from "@/lib/demo/request";
import { runtimeExperience } from "@/lib/demo/runtime-experience";
import { runtimeDescriptor } from "@/lib/demo/runtime-view";

/** The template whose reference deployment +slug+ names, which the template demo runs here until it's removed (add-applications, task group 10). */
function referenceOf(slug: string) {
  return demoEnabled() ? referenceTemplate(slug) : undefined;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const template = referenceOf(slug);
  // The portal's own favicon: never the Frontend Registry's.
  if (template) return { title: { absolute: `${template.title} · ${BRANDS[template.brand].portalName}` }, icons: { icon: [{ url: runtimeExperience(template.brand).favicon }] } };
  if (!applicationsAvailable()) return {};
  const application = findApplication(getDb(), slug);
  return application ? { title: application.name } : { title: "Page not found" };
}

/**
 * A running application (add-applications, design decision 5): its page
 * renders the application's build in a frame under the toolbar. The
 * template demo's reference deployments still run here, in their portal
 * shell and without the toolbar, until the demo is removed; this layout
 * keeps that runtime across their routes, so its client state survives
 * navigation.
 */
export default async function RunLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const template = referenceOf((await params).slug);
  if (!template) return children;
  const descriptor = runtimeDescriptor(template, await currentWorkspace());
  if (!descriptor) notFound();
  return <PortalRuntime descriptor={descriptor}>{children}</PortalRuntime>;
}
