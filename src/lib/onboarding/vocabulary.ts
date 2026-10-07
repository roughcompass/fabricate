/*
 * The fixed vocabularies of onboarding: rendering modes, Portal
 * capabilities, iframe sandbox tokens and permissions, and loading
 * strategies, with the labels people read. Forms in the browser use them,
 * so this module imports nothing: anything it imported would ship to the
 * browser too.
 */

/** How a Portal renders a launch target. */
export const RENDERING_MODES = ["iframe", "esm", "module_federation_2"] as const;
export type RenderingMode = (typeof RENDERING_MODES)[number];

export const RENDERING_MODE_LABELS: Record<RenderingMode, string> = { iframe: "iframe", esm: "ESM module", module_federation_2: "Module Federation 2" };

/** The runtime mechanisms a Portal offers and an Application or MFE may require. */
export const CAPABILITIES = ["navigation", "session_context", "authentication_context", "theme", "events", "error_boundary"] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const CAPABILITY_LABELS: Record<Capability, string> = {
  navigation: "Navigation",
  session_context: "Session context",
  authentication_context: "Authentication context",
  theme: "Theme",
  events: "Events",
  error_boundary: "Error boundary",
};

/** The iframe sandbox tokens a Portal may allow. */
export const SANDBOX_TOKENS = [
  "allow-downloads",
  "allow-forms",
  "allow-modals",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-same-origin",
  "allow-scripts",
  "allow-storage-access-by-user-activation",
  "allow-top-navigation-by-user-activation",
] as const;

/** The permissions-policy features a Portal may delegate to an iframe. */
export const IFRAME_PERMISSIONS = ["camera", "clipboard-read", "clipboard-write", "fullscreen", "geolocation", "microphone", "payment", "web-share"] as const;

export const LOADING_STRATEGIES = ["eager", "lazy"] as const;
