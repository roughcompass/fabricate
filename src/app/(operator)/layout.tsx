import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { getConfig } from "@/lib/config";
import { THEME_COOKIE, parseTheme } from "@/lib/web/theme";

/** Every operator page renders inside the application shell. */
export default async function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return <AppShell theme={theme} demo={getConfig().demoEnabled}>{children}</AppShell>;
}
