import { and, eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { portals } from "@/lib/db/schema";
import { onboardedPortal } from "@/lib/onboarding/catalog";
import type { Portal } from "@/lib/onboarding/portals";

/*
 * The operator's current Portal (portal-switcher spec), kept in a cookie so
 * the server renders the switcher and the scoped lists on first paint. It
 * holds a Portal's public ID, which grants nothing; only Server Actions set
 * it, so it's httpOnly.
 */

export const PORTAL_COOKIE = "fabricate-portal";
export const PORTAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The Portal +value+ names, if it's one the switcher lists: an onboarded
 * Portal, in either lifecycle. Anything else, such as a Portal that no
 * longer exists, means All Portals, so null.
 */
export function currentPortal(db: Executor, value: string | undefined): Portal | null {
  if (!isPublicId(value, "ptl")) return null;
  return db.select().from(portals).where(and(eq(portals.publicId, value), onboardedPortal(db))).get() ?? null;
}
