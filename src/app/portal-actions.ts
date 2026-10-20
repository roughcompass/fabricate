"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { PORTALS_HREF, portalHref } from "@/lib/portals/paths";
import { text } from "@/lib/web/form-data";
import { PORTAL_COOKIE, currentPortal } from "@/lib/web/portal";
import { rememberPortal } from "@/lib/web/portal-cookie";

/** A Runtime Configuration page of one Portal, whose Portal a choice in the switcher replaces; the rest of the address stays. */
const PORTAL_PAGE = /^\/portals\/ptl_[a-z0-9]+(\/[^?#]*)?$/;

/**
 * Chooses the current Portal from the sidebar's switcher (portal-switcher
 * spec), or All Portals for an empty value. A value that doesn't name a
 * listed Portal also means All Portals. The page re-renders in place with the
 * new scope, so choosing works without JavaScript. On a Runtime
 * Configuration page, the same page of the chosen Portal opens instead, or
 * the Portals page for All Portals.
 */
export async function selectPortalAction(formData: FormData): Promise<void> {
  const portal = currentPortal(getDb(), text(formData, "portal", 40));
  const jar = await cookies();
  if (portal) await rememberPortal(portal.publicId);
  else jar.delete(PORTAL_COOKIE);
  const from = PORTAL_PAGE.exec(text(formData, "from", 200));
  if (from) redirect(portal ? `${portalHref(portal.publicId)}${from[1] ?? ""}` : PORTALS_HREF);
  refresh();
}
