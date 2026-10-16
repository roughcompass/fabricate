"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db/client";
import { text } from "@/lib/web/form-data";
import { PORTAL_COOKIE, currentPortal } from "@/lib/web/portal";
import { rememberPortal } from "@/lib/web/portal-cookie";

/**
 * Chooses the current Portal from the sidebar's switcher (portal-switcher
 * spec), or All Portals for an empty value. A value that doesn't name a
 * listed Portal also means All Portals. The page re-renders in place with the
 * new scope, so choosing works without JavaScript.
 */
export async function selectPortalAction(formData: FormData): Promise<void> {
  const portal = currentPortal(getDb(), text(formData, "portal", 40));
  const jar = await cookies();
  if (portal) await rememberPortal(portal.publicId);
  else jar.delete(PORTAL_COOKIE);
  refresh();
}
