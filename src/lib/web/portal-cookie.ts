import { cookies } from "next/headers";
import type { Executor } from "@/lib/db/client";
import type { Portal } from "@/lib/onboarding/portals";
import { PORTAL_COOKIE, PORTAL_COOKIE_MAX_AGE, currentPortal } from "./portal";

/** The operator's current Portal from their cookie, or null for All Portals; the scoped pages read it. */
export async function rememberedPortal(db: Executor): Promise<Portal | null> {
  return currentPortal(db, (await cookies()).get(PORTAL_COOKIE)?.value);
}

/** Makes +publicId+ the current Portal, such as after creating it. Only Server Actions can set cookies, so only they call it. */
export async function rememberPortal(publicId: string): Promise<void> {
  (await cookies()).set(PORTAL_COOKIE, publicId, { path: "/", maxAge: PORTAL_COOKIE_MAX_AGE, sameSite: "lax", httpOnly: true });
}
