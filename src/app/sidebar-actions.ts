"use server";

import { cookies } from "next/headers";
import { text } from "@/lib/web/form-data";
import { legacyCookieName } from "@/lib/web/preference-cookies";
import { SIDEBAR_HIDDEN, SIDEBAR_HIDDEN_COOKIE } from "@/lib/web/sidebar";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Hides or shows the sidebar. Setting the cookie re-renders the current page
 * with it, so the control works without JavaScript; with JavaScript, the
 * control flips the shell at once and writes the same cookie itself, which is
 * why the cookie is not httpOnly.
 */
export async function setSidebarVisibility(formData: FormData): Promise<void> {
  const jar = await cookies();
  if (text(formData, "sidebar", 10) === SIDEBAR_HIDDEN) jar.set(SIDEBAR_HIDDEN_COOKIE, SIDEBAR_HIDDEN, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  else for (const name of [SIDEBAR_HIDDEN_COOKIE, legacyCookieName(SIDEBAR_HIDDEN_COOKIE)]) if (name) jar.delete(name);
}
