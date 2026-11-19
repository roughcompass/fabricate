/**
 * Names from before the product took its name, the Frontend Registry
 * (establish-frontend-registry, design decision 9). They are still read for
 * one release, so deployments and browsers keep working while they move to
 * the new names: environment variables, the configuration file, preference
 * cookies, and the template demo's local storage keys. Nothing writes them.
 * Remove this module, and every fallback that reads it, in the next release.
 */
export const LEGACY_NAMES = {
  /** The prefix FRONTEND_REGISTRY_* environment variables had. */
  envPrefix: "FABRICATE_",
  /** The configuration file's name in config/. */
  configFile: "fabricate.json",
  /** Preference cookies, by the cookie each became. */
  cookies: {
    "frontend-registry-theme": "fabricate-theme",
    "frontend-registry-sidebar": "fabricate-sidebar",
    "frontend-registry-sidebar-width": "fabricate-sidebar-width",
  } as Readonly<Record<string, string>>,
  /** The prefix of the template demo's local storage keys. */
  demoStoragePrefix: "fabricate-demo",
} as const;
