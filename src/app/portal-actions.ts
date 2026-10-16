"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { text } from "@/lib/web/form-data";
import { PORTAL_COOKIE, currentPortal } from "@/lib/web/portal";
import { rememberPortal } from "@/lib/web/portal-cookie";

/** A Portal's Navigation page, whose Portal a choice in the switcher replaces. */
const NAVIGATION_PAGE = /^\/navigation\/ptl_[a-z0-9]+\/?$/;

/**
 * Chooses the current Portal from the sidebar's switcher (portal-switcher
 * spec), or All Portals for an empty value. A value that doesn't name a
 * listed Portal also means All Portals. The page re-renders in place with the
 * new scope, so choosing works without JavaScript; on a Portal's Navigation
 * page, the chosen Portal's opens instead, or the list for All Portals.
 */
export async function selectPortalAction(formData: FormData): Promise<void> {
  const portal = currentPortal(getDb(), text(formData, "portal", 40));
  const jar = await cookies();
  if (portal) await rememberPortal(portal.publicId);
  else jar.delete(PORTAL_COOKIE);
  if (NAVIGATION_PAGE.test(text(formData, "from", 200))) redirect(portal ? `/navigation/${portal.publicId}` : "/navigation");
  refresh();
}
