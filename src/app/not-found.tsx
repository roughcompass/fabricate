import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { NotFoundPage } from "@/components/shell/system-page";
import { getConfig } from "@/lib/config";
import { THEME_COOKIE, parseTheme } from "@/lib/web/theme";

// Unmatched URLs render against the root layout, outside (operator)/layout.tsx,
// so this page brings the application shell itself.
export default async function NotFound() {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <AppShell theme={theme} demo={getConfig().demoEnabled}>
      <NotFoundPage noun="Page" listHref="/" listLabel="Initiatives" />
    </AppShell>
  );
}
