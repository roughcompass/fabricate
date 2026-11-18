import type { PortalExperience } from "@/demo/runtime/portal/types";
import { BRANDS, type BrandId } from "./catalog";

/*
 * The experience a running reference deployment renders: its brand's portal
 * name and shell, the J.P. Morgan logo and favicon, no banner, and no menu of
 * its own.
 */

export const LOGO = { light: "/brand/jpmorgan-logo.svg", dark: "/brand/jpmorgan-logo-dark.svg", alt: "J.P. Morgan" } as const;

/** The portal's favicon: never DE FabLab's. */
const FAVICON = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#1b2a3a"/><text x="32" y="45" font-family="Georgia,serif" font-size="40" font-weight="700" fill="#fff" text-anchor="middle">J</text></svg>')}`;

export interface RuntimeExperience {
  readonly shell: "access" | "markets";
  readonly experience: PortalExperience;
  /** The favicon's data URL. */
  readonly favicon: string;
}

/** The experience an application of +brand+ renders, with the copyright of +now+'s year. */
export function runtimeExperience(brand: BrandId, now: Date = new Date()): RuntimeExperience {
  const { shell, portalName } = BRANDS[brand];
  return {
    shell,
    favicon: FAVICON,
    experience: {
      portalName: portalName.replace(/^J\.P\. Morgan /, ""),
      logo: LOGO,
      logoLinksHome: true,
      banner: null,
      headerSlots: ["toggle", "brand", "actions", "feedback", "user-menu"],
      search: null,
      notifications: null,
      sidebar: { shown: true, menuType: shell === "markets" ? "flyout" : "left", slots: ["top", "main", "bottom"] },
      menu: [],
      footer: { shown: true, slots: ["primary", "secondary", "tertiary"], copyright: `© ${now.getFullYear()} JPMorgan Chase & Co. All rights reserved.` },
    },
  };
}
