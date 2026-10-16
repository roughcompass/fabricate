"use client";

import { usePathname } from "next/navigation";
import { openCreatePortal } from "@/components/onboarding/create-portal-events";
import { Switcher } from "@/components/ui/switcher";
import type { SwitcherPortal } from "@/lib/onboarding/catalog";
import { PORTAL_LIFECYCLE_LABELS, PORTAL_PLATFORM_LABELS } from "@/lib/onboarding/vocabulary";
import { closeDrawer } from "./sidebar-nav";

/**
 * The sidebar's Portal switcher (portal-switcher spec): the current Portal,
 * or All Portals, and a list of the onboarded Portals to choose from, each
 * with its platform and lifecycle, filtered by name, slug, or SEAL ID.
 * Choosing one scopes Applications and Navigation to it and, in the drawer,
 * closes the drawer; each choice posts the page it was made on, so on a
 * Portal's Navigation page it opens the chosen Portal's. Create Portal opens
 * the Create Portal dialog, or the New Portal page before JavaScript runs.
 */
export function PortalSwitcher({ portals, current, action }: { portals: readonly SwitcherPortal[]; current: string | null; action: (formData: FormData) => Promise<void> }) {
  const pathname = usePathname();
  return (
    <Switcher
      label="Switch Portal"
      pinned={{ value: "", label: "All Portals", icon: "layers" }}
      options={portals.map((portal) => ({
        value: portal.publicId,
        label: portal.label,
        tag: portal.platform ? PORTAL_PLATFORM_LABELS[portal.platform] : null,
        badge: { state: portal.lifecycle, label: PORTAL_LIFECYCLE_LABELS[portal.lifecycle] },
        terms: [portal.slug, portal.sealId],
      }))}
      current={current ?? ""}
      action={action}
      field="portal"
      fields={{ from: pathname }}
      searchLabel="Find Portal…"
      empty="Portals you create appear here for quick switching."
      noMatch="No Portal matches"
      footer={{ label: "Create Portal", description: "Onboard a Portal its team configures", icon: "plus", href: "/navigation/new", onChoose: openCreatePortal }}
      onChosen={closeDrawer}
    />
  );
}
