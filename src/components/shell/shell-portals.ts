import { getDb } from "@/lib/db/client";
import { portalSwitcherList } from "@/lib/onboarding/catalog";
import { whatsIncluded } from "@/lib/onboarding/whats-included";
import { currentPortal } from "@/lib/web/portal";
import type { ShellPortals } from "./app-shell";
import { type NavFlags, menuItems, visibleGroups } from "./navigation";

/**
 * What the sidebar's Portal switcher and the Create Portal dialog need
 * (portal-switcher and portal-creation specs): the onboarded Portals, the
 * current one from the remembered cookie value, and the What's included
 * content. Only while the Applications item is shown; otherwise there's
 * neither, and nothing is read.
 */
export function shellPortals(nav: NavFlags, remembered: string | undefined): ShellPortals | null {
  if (!menuItems(visibleGroups(nav)).some((item) => item.id === "applications")) return null;
  const db = getDb();
  return { list: portalSwitcherList(db), current: currentPortal(db, remembered)?.publicId ?? null, included: whatsIncluded() };
}
