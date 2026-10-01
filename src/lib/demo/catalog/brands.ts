import type { Brand, BrandId, Persona, Profile, Provider, ProviderId } from "./types";

/**
 * The four portal brands (design.md, decision 20). Payments, Global Banking,
 * and Other render in the J.P. Morgan Access shell, Markets in the J.P. Morgan
 * Markets shell. The names are plain-text wordmarks in an internal demo; the
 * shells are illustrative, and the sample data inside them is fictional.
 */
export const ACCESS_PORTAL = "J.P. Morgan Access";
export const MARKETS_PORTAL = "J.P. Morgan Markets";

export const BRANDS: Readonly<Record<BrandId, Brand>> = {
  payments: { id: "payments", label: "Payments", shell: "access", portalName: ACCESS_PORTAL, tagline: "Move money with confidence" },
  "global-banking": { id: "global-banking", label: "Global Banking", shell: "access", portalName: ACCESS_PORTAL, tagline: "Serving clients across borders" },
  markets: { id: "markets", label: "Markets", shell: "markets", portalName: MARKETS_PORTAL, tagline: "Prices, flow, and execution" },
  other: { id: "other", label: "Other", shell: "access", portalName: ACCESS_PORTAL, tagline: "Tools for every team" },
};

export const PROVIDERS: Readonly<Record<ProviderId, Provider>> = {
  "de-web": { id: "de-web", label: "DE Web" },
  community: { id: "community", label: "Community" },
};

/**
 * The built-in session profiles, one per persona. Their ids predate profiles
 * (they were persona ids), so stored views and old share links still resolve.
 */
export const BUILT_IN_PROFILES: readonly Profile[] = [
  { id: "analyst", name: "Jordan Lee", persona: "Analyst", region: "London", builtIn: true },
  { id: "approver", name: "Sam Rivera", persona: "Approver", region: "New York", builtIn: true },
  { id: "administrator", name: "Alex Morgan", persona: "Administrator", region: "Singapore", builtIn: true },
];

/** Jordan Lee, the profile a view falls back to when its own no longer exists. */
export const DEFAULT_PROFILE = BUILT_IN_PROFILES[0]!;

export function builtInProfile(id: string | undefined): Profile | undefined {
  return BUILT_IN_PROFILES.find((profile) => profile.id === id);
}

/** The built-in profile with a persona, whose id a share link stores for links from before profiles. */
export function builtInProfileFor(persona: Persona): Profile {
  return BUILT_IN_PROFILES.find((profile) => profile.persona === persona)!;
}
