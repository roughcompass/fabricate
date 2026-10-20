import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { type Portal, findPortal, isOnboarded } from "@/lib/onboarding/portals";

/** The onboarded Portal +portalId+ names, or null: what a Portal's pages, and its experience editor, show. */
export function onboardedPortal(portalId: string): Portal | null {
  if (!isPublicId(portalId, "ptl")) return null;
  const db = getDb();
  const portal = findPortal(db, portalId);
  return portal && isOnboarded(db, portal.id) ? portal : null;
}
