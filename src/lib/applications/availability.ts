import { notFound } from "next/navigation";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";

/**
 * Whether applications are offered (applications/onboarding spec,
 * "Applications are available while previews are"): Applications,
 * onboarding, application pages, preview mode, running applications, and
 * share links exist only while `previews.enabled` is on. Each page, Server
 * Action, and route handler checks it itself. Turning previews off deletes
 * nothing: applications reappear, with their last state, when it's on again.
 */

export function applicationsAvailable(config: FrontendRegistryConfig = getConfig()): boolean {
  return config.previews.enabled;
}

/**
 * For pages and Server Actions: renders the not-found page while applications aren't offered.
 * @public The Applications pages and their actions use this (add-applications tasks 5 to 8).
 */
export function requireApplications(config?: FrontendRegistryConfig): void {
  if (!applicationsAvailable(config)) notFound();
}

/**
 * For route handlers: a plain 404 while applications aren't offered, otherwise null.
 * @public The Applications pages and their actions use this (add-applications tasks 5 to 8).
 */
export function applicationsUnavailable(config?: FrontendRegistryConfig): Response | null {
  return applicationsAvailable(config) ? null : new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
