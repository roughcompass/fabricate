"use client";

import { openCreatePortal } from "@/components/onboarding/create-portal-events";
import { Switcher } from "@/components/ui/switcher";
import type { SwitcherPortal } from "@/lib/onboarding/catalog";
import { PORTAL_PLATFORM_LABELS } from "@/lib/onboarding/vocabulary";
import { closeDrawer } from "./sidebar-nav";

/**
 * The sidebar's Portal switcher (portal-switcher spec): the current Portal,
 * or All Portals, and a list of the onboarded Portals to choose from, filtered
 * by name, slug, or SEAL ID. Choosing one scopes Web Onboarding to it and,
 * in the drawer, closes the drawer. Create Portal opens the Create Portal
 * dialog, or the New Portal page before JavaScript runs.
 */
export function PortalSwitcher({ portals, current, action }: { portals: readonly SwitcherPortal[]; current: string | null; action: (formData: FormData) => Promise<void> }) {
  return (
    <Switcher
      label="Switch Portal"
      pinned={{ value: "", label: "All Portals", icon: "layers" }}
      options={portals.map((portal) => ({ value: portal.publicId, label: portal.label, tag: portal.platform ? PORTAL_PLATFORM_LABELS[portal.platform] : null, terms: [portal.slug, portal.sealId] }))}
      current={current ?? ""}
      action={action}
      field="portal"
      searchLabel="Find Portal…"
      empty="Portals you create appear here for quick switching."
      noMatch="No Portal matches"
      footer={{ label: "Create Portal", description: "Onboard a Portal its team configures", icon: "plus", href: "/onboarding/portals/new", onChoose: openCreatePortal }}
      onChosen={closeDrawer}
    />
  );
}
