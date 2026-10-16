import { notFound } from "next/navigation";
import { getConfig } from "@/lib/config";

/**
 * The Prototypes switch (prototypes/availability spec, "Prototypes is
 * available only when enabled"). Every Prototypes page, render frame, share
 * link, Server Action, and route handler checks it itself rather than relying
 * on the proxy, so a disabled Prototypes answers not found everywhere.
 */

export function prototypesEnabled(): boolean {
  return getConfig().prototypes.enabled;
}

/**
 * Whether accepting a version as a template is offered: only where the Salt
 * Patterns gallery it publishes to exists, that is, with the template demo on
 * and outside the hosted profile (proposal, "Non-goals").
 */
export function templatesAvailable(): boolean {
  const config = getConfig();
  return config.demoEnabled && config.profile !== "hosted";
}

/** For pages and Server Actions: renders the not-found page when Prototypes is off. */
export function requirePrototypes(): void {
  if (!prototypesEnabled()) notFound();
}

/** For route handlers: a 404 response when Prototypes is off, otherwise null. */
export function prototypesUnavailable(): Response | null {
  return prototypesEnabled() ? null : new Response(null, { status: 404 });
}
