import { and, eq, exists, ne, sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { portalRevisions, portals } from "@/lib/db/schema";
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
 * The Portal +value+ names, if it's one the switcher lists: onboarded, so it
 * has a configuration revision, and not Retired. Anything else, including a
 * Portal retired since it was chosen, means All Portals, so null.
 */
export function currentPortal(db: Executor, value: string | undefined): Portal | null {
  if (!isPublicId(value, "ptl")) return null;
  return (
    db
      .select()
      .from(portals)
      .where(and(eq(portals.publicId, value), ne(portals.lifecycle, "retired"), exists(db.select({ one: sql`1` }).from(portalRevisions).where(eq(portalRevisions.portalId, portals.id)))))
      .get() ?? null
  );
}
