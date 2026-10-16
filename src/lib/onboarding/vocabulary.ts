/*
 * The fixed vocabularies of onboarding: Portal platforms and lifecycles,
 * with the labels people read. Forms in the browser use them, so this module
 * imports nothing: anything it imported would ship to the browser too.
 */

/**
 * The platform a Portal targets (portals spec): a classification, not a
 * runtime definition, so nothing validates or places against it.
 */
export const PORTAL_PLATFORMS = ["web", "mobile", "desktop"] as const;
export type PortalPlatform = (typeof PORTAL_PLATFORMS)[number];
export const PORTAL_PLATFORM_LABELS: Record<PortalPlatform, string> = { web: "Web", mobile: "Mobile", desktop: "Desktop" };
export const PORTAL_PLATFORM_DESCRIPTIONS: Record<PortalPlatform, string> = {
  web: "Opens in a browser",
  mobile: "Runs on phones and tablets",
  desktop: "Runs as an installed application",
};

/**
 * Where a Portal is in its life (make-applications-first-class design
 * decision 9): every Portal starts as a Prototype, and its team promotes it
 * to Production or returns it.
 */
export const PORTAL_LIFECYCLES = ["prototype", "production"] as const;
export type PortalLifecycle = (typeof PORTAL_LIFECYCLES)[number];
export const PORTAL_LIFECYCLE_LABELS: Record<PortalLifecycle, string> = { prototype: "Prototype", production: "Production" };
