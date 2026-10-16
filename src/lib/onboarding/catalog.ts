import { compareCodeUnits } from "@repo-facts/contract";
import { asc, eq, exists, sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { applications, onboardingEvents, portalMenuItems, portals } from "@/lib/db/schema";
import type { PortalLifecycle, PortalPlatform } from "./vocabulary";

/*
 * The onboarded Portals, as the sidebar's switcher and the Navigation list
 * show them. A Portal is onboarded once it has a history: it was created
 * through Portal creation or carried over from earlier onboarding. One named
 * only in an ownership claim isn't.
 */

/** Rows of `portals` that are onboarded, as a condition. */
export const onboardedPortal = (db: Executor) => exists(db.select({ one: sql`1` }).from(onboardingEvents).where(eq(onboardingEvents.portalId, portals.id)));

/** A Portal as the sidebar's switcher lists it. */
export interface SwitcherPortal {
  publicId: string;
  label: string;
  slug: string | null;
  sealId: string | null;
  platform: PortalPlatform | null;
  lifecycle: PortalLifecycle;
}

/**
 * The Portals the sidebar's switcher offers (portal-switcher spec): every
 * onboarded Portal, with its lifecycle, sorted by name. One narrow query,
 * since the shell runs it on every page.
 */
export function portalSwitcherList(db: Executor): SwitcherPortal[] {
  return db
    .select({ publicId: portals.publicId, label: portals.label, slug: portals.slug, sealId: portals.sealId, platform: portals.platform, lifecycle: portals.lifecycle })
    .from(portals)
    .where(onboardedPortal(db))
    .orderBy(asc(portals.labelKey), asc(portals.publicId))
    .all();
}

export const NAVIGATION_TABS = ["all", "prototype", "production"] as const;
export type NavigationTab = (typeof NAVIGATION_TABS)[number];

export interface PortalListRow {
  portal: typeof portals.$inferSelect;
  menuItems: number;
  applications: number;
}

/**
 * Every onboarded Portal with how many menu items and Applications it has
 * (navigation spec), sorted by name, and how many each tab holds. Three
 * queries, whatever the number of Portals.
 */
export function portalCatalog(db: Executor, tab: NavigationTab = "all"): { rows: PortalListRow[]; counts: Record<NavigationTab, number> } {
  const all = db.select().from(portals).where(onboardedPortal(db)).all();
  const items = new Map(
    db
      .select({ portalId: portalMenuItems.portalId, count: sql<number>`count(*)` })
      .from(portalMenuItems)
      .where(eq(portalMenuItems.kind, "item"))
      .groupBy(portalMenuItems.portalId)
      .all()
      .map((row) => [row.portalId, row.count]),
  );
  const registered = new Map(
    db
      .select({ portalId: applications.portalId, count: sql<number>`count(*)` })
      .from(applications)
      .where(sql`${applications.portalId} IS NOT NULL`)
      .groupBy(applications.portalId)
      .all()
      .map((row) => [row.portalId, row.count]),
  );
  const counts = { all: all.length, prototype: all.filter((portal) => portal.lifecycle === "prototype").length, production: all.filter((portal) => portal.lifecycle === "production").length };
  const rows = all
    .filter((portal) => tab === "all" || portal.lifecycle === tab)
    .map((portal) => ({ portal, menuItems: items.get(portal.id) ?? 0, applications: registered.get(portal.id) ?? 0 }))
    .sort((a, b) => compareCodeUnits(a.portal.labelKey, b.portal.labelKey) || compareCodeUnits(a.portal.publicId, b.portal.publicId));
  return { rows, counts };
}
