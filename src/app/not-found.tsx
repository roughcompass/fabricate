import { AppShell } from "@/components/shell/app-shell";
import { HOME } from "@/components/shell/navigation";
import { shellPreferences } from "@/components/shell/shell-preferences";
import { NotFoundPage } from "@/components/shell/system-page";
import { navFlags } from "@/components/shell/nav-flags";

// Unmatched URLs render against the root layout, outside (operator)/layout.tsx,
// so this page brings the application shell itself. It links to Home (home spec).
export default async function NotFound() {
  const { theme, sidebar } = await shellPreferences();
  const nav = navFlags();
  return (
    <AppShell theme={theme} sidebar={sidebar} nav={nav}>
      <NotFoundPage noun="Page" listHref={HOME.href} listLabel={HOME.label} />
    </AppShell>
  );
}
