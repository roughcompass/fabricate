import { cookies } from "next/headers";
import { SIDEBAR_HIDDEN_COOKIE, SIDEBAR_WIDTH_COOKIE, parseSidebarHidden, parseSidebarWidth } from "@/lib/web/sidebar";
import { THEME_COOKIE, parseTheme } from "@/lib/web/theme";
import type { SidebarPreferences } from "./app-shell";

/**
 * The operator's theme and sidebar from their cookies, so the server renders
 * the shell as they left it.
 */
export async function shellPreferences(): Promise<{ theme: ReturnType<typeof parseTheme>; sidebar: SidebarPreferences }> {
  const jar = await cookies();
  return {
    theme: parseTheme(jar.get(THEME_COOKIE)?.value),
    sidebar: { width: parseSidebarWidth(jar.get(SIDEBAR_WIDTH_COOKIE)?.value), hidden: parseSidebarHidden(jar.get(SIDEBAR_HIDDEN_COOKIE)?.value) },
  };
}
