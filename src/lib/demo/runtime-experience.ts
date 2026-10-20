import type { PortalExperience } from "@/demo/runtime/portal/types";
import type { Executor } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import type { Catalogs } from "@/lib/experience/catalogs";
import { type Experience, activeMessage, bannerPresentation, defaultExperience, slotShown } from "@/lib/experience/document";
import { currentExperience } from "@/lib/experience/versions";
import { findPortal, isOnboarded } from "@/lib/onboarding/portals";
import { BRANDS, type BrandId } from "./catalog";

/*
 * The experience a running application renders (add-portal-experience-
 * editor, design decision 8). Opened with ?portal=<ptl id>, it's that
 * Portal's current saved experience; otherwise, or for a Portal that isn't
 * onboarded, the default. Pending changes live only in the editor's browser
 * tab, so they never reach here.
 */

/** The request header the proxy copies ?portal= into, for the run layout, which doesn't receive the query. */
export const PORTAL_HEADER = "x-fabricate-portal";

export const LOGO = { light: "/brand/jpmorgan-logo.svg", dark: "/brand/jpmorgan-logo-dark.svg", alt: "J.P. Morgan" } as const;

export interface RuntimeExperience {
  /** The Portal the application is opened for, or null for none. */
  readonly portalId: string | null;
  /** The shell the experience's theme uses. */
  readonly shell: "access" | "markets";
  readonly experience: PortalExperience;
  /** The favicon's data URL, or null for none. */
  readonly favicon: string | null;
}

/** The parts of +experience+ a shell renders, at +now+ (for which message is live). */
export function portalExperience(experience: Experience, now: Date = new Date()): PortalExperience {
  const { frame } = experience;
  const shown = (zone: "header" | "sidebar" | "footer") => (frame[zone].visible ? frame[zone].slots.filter((slot) => slotShown(experience, zone, slot.id)).map((slot) => slot.id) : []);
  const message = slotShown(experience, "banner", "message") ? activeMessage(experience, now) : null;
  const headerSlots = shown("header");
  return {
    portalName: experience.brand.portalName,
    logo: LOGO,
    logoLinksHome: experience.brand.logoLinksHome,
    banner: message ? { title: message.title, description: message.description, ...bannerPresentation(experience, message) } : null,
    headerSlots,
    search: headerSlots.includes("global-search") ? { placeholder: experience.toolkits.globalSearch.placeholder, shortcut: experience.toolkits.globalSearch.shortcut } : null,
    notifications: headerSlots.includes("notifications") ? { ...experience.toolkits.notifications } : null,
    sidebar: { shown: frame.sidebar.visible, menuType: frame.sidebar.menuType, slots: shown("sidebar") },
    menu: experience.menu.map(({ id, parentId, kind, label, route }) => ({ id, parentId, kind, label, route })),
    footer: { shown: frame.footer.visible, slots: shown("footer"), copyright: experience.copyright },
  };
}

/** The default experience for an application of +brand+ opened without a Portal: the brand's portal name and shell, the default favicon, the catalog's default toolkits, and no menu of its own. */
export function defaultRuntimeExperience(brand: BrandId, catalogs: Pick<Catalogs, "toolkits" | "themes">, now: Date = new Date()): RuntimeExperience {
  const { shell, portalName } = BRANDS[brand];
  const document = defaultExperience({ label: portalName.replace(/^J\.P\. Morgan /, "") }, [], catalogs.toolkits, catalogs.themes, now.getFullYear());
  document.frame.sidebar.menuType = shell === "markets" ? "flyout" : "left";
  return { portalId: null, shell, experience: portalExperience(document, now), favicon: document.favicon.dataUrl };
}

/** The experience an application of +brand+ renders when opened for +portalId+: the Portal's current saved one, or the default. */
export function runtimeExperience(db: Executor, brand: BrandId, portalId: string | null, catalogs: Pick<Catalogs, "toolkits" | "themes">, now: Date = new Date()): RuntimeExperience {
  const portal = portalId && isPublicId(portalId, "ptl") ? findPortal(db, portalId) : undefined;
  if (!portal || !isOnboarded(db, portal.id)) return defaultRuntimeExperience(brand, catalogs, now);
  const { experience } = currentExperience(db, portal, catalogs);
  const shell = catalogs.themes.find((theme) => theme.id === experience.theme.id)?.shell ?? BRANDS[brand].shell;
  return { portalId: portal.publicId, shell, experience: portalExperience(experience, now), favicon: experience.favicon.enabled ? experience.favicon.dataUrl : null };
}
