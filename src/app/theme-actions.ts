"use server";

import { cookies } from "next/headers";
import { text } from "@/lib/web/form-data";
import { THEME_COOKIE, parseTheme } from "@/lib/web/theme";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Stores the theme preference. Setting a cookie re-renders the current page
 * with it, so the change applies without a client script, and the form works
 * without JavaScript.
 */
export async function setThemePreference(formData: FormData): Promise<void> {
  const theme = parseTheme(text(formData, "theme", 10));
  (await cookies()).set(THEME_COOKIE, theme, { path: "/", maxAge: ONE_YEAR, sameSite: "lax", httpOnly: true });
}
