import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { PortalRuntime } from "@/demo/runtime/portal-runtime";
import { RuntimeToolbar } from "@/demo/runtime/runtime-toolbar";
import { getDb } from "@/lib/db/client";
import { type DemoView, resolveView, viewTemplate } from "@/lib/demo/access";
import { BRANDS } from "@/lib/demo/catalog";
import { demoEnabled, requireDemo } from "@/lib/demo/guard";
import { listProfiles } from "@/lib/demo/profiles";
import { currentWorkspace } from "@/lib/demo/request";
import { runtimeDescriptor, shareCookieName } from "@/lib/demo/runtime-view";
import type { Workspace } from "@/lib/demo/workspaces";

async function resolve(applicationId: string): Promise<{ view: DemoView; workspace: Workspace | null; token: string | null } | null> {
  const workspace = await currentWorkspace();
  const token = (await cookies()).get(shareCookieName(applicationId))?.value ?? null;
  const db = getDb();
  // A remembered share link opens the sharer's view; otherwise the visitor's own.
  const shared = token ? resolveView(db, applicationId, workspace, token) : null;
  const view = shared ?? resolveView(db, applicationId, workspace, null);
  return view ? { view, workspace, token: shared ? token : null } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ applicationId: string }> }): Promise<Metadata> {
  if (!demoEnabled()) return {};
  const resolved = await resolve((await params).applicationId);
  const template = resolved && viewTemplate(resolved.view.target);
  if (!resolved || !template) return { title: "Page not found" };
  const name = resolved.view.target.kind === "application" ? resolved.view.target.application.name : template.title;
  return { title: { absolute: `${name} · ${BRANDS[template.brand].portalName}` } };
}

/**
 * A running demo application: its portal shell, its microfrontends, and the
 * toolbar. The layout persists across the application's routes, so client
 * state such as the event bus and the timing records survives navigation.
 */
export default async function RunLayout({ children, params }: { children: React.ReactNode; params: Promise<{ applicationId: string }> }) {
  requireDemo();
  const resolved = await resolve((await params).applicationId);
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
