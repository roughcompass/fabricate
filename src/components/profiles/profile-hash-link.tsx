"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { type ProfileTabId, profileSectionHref, tabOf } from "@/lib/profiles/tabs";

/**
 * Keeps a link to a section of the Profile working when the section is in
 * another view: an address such as `…#ci_systems`, from before the Profile
 * had views or from a bookmark, opens the view that holds CI systems at it.
 * Links the Frontend Registry writes already name the view, so this is only a fallback,
 * and without JavaScript such an address opens the Overview.
 */
export function ProfileHashLink({ base, current }: { base: string; current: ProfileTabId }) {
  const router = useRouter();
  useEffect(() => {
    const section = decodeURIComponent(window.location.hash.slice(1));
    if (!section || document.getElementById(section)) return;
    if (tabOf(section) !== current) router.replace(profileSectionHref(base, section));
  }, [base, current, router]);
  return null;
}
