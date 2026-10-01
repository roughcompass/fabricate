import type { Brand, BrandId, Persona, Provider, ProviderId } from "./types";

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

/** Session personas the portal shell provides to every microfrontend. */
export const PERSONAS: readonly Persona[] = [
  { id: "analyst", name: "Jordan Lee", role: "Analyst", region: "London" },
  { id: "approver", name: "Sam Rivera", role: "Approver", region: "New York" },
  { id: "administrator", name: "Alex Morgan", role: "Administrator", region: "Singapore" },
];

export const DEFAULT_PERSONA = PERSONAS[0]!;

export function personaById(id: string | undefined): Persona {
  return PERSONAS.find((persona) => persona.id === id) ?? DEFAULT_PERSONA;
}
