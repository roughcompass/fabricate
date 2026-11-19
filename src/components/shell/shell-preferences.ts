import { cookies } from "next/headers";
import { SIDEBAR_HIDDEN_COOKIE, SIDEBAR_WIDTH_COOKIE, parseSidebarHidden, parseSidebarWidth } from "@/lib/web/sidebar";
import { preferenceCookie } from "@/lib/web/preference-cookies";
import { THEME_COOKIE, parseTheme } from "@/lib/web/theme";
import type { SidebarPreferences } from "./app-shell";

/**
 * The operator's theme and sidebar from their cookies, so the server renders
 * the shell as they left it. Cookies under their names from before the rename
 * still count for one release.
 */
export async function shellPreferences(): Promise<{ theme: ReturnType<typeof parseTheme>; sidebar: SidebarPreferences }> {
  const jar = await cookies();
  return {
    theme: parseTheme(preferenceCookie(jar, THEME_COOKIE)),
    sidebar: { width: parseSidebarWidth(preferenceCookie(jar, SIDEBAR_WIDTH_COOKIE)), hidden: parseSidebarHidden(preferenceCookie(jar, SIDEBAR_HIDDEN_COOKIE)) },
  };
}
