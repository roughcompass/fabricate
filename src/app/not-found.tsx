import { AppShell } from "@/components/shell/app-shell";
import { homeLink, visibleGroups } from "@/components/shell/navigation";
import { shellPreferences } from "@/components/shell/shell-preferences";
import { NotFoundPage } from "@/components/shell/system-page";
import { navFlags } from "@/components/shell/nav-flags";
import { shellPortals } from "@/components/shell/shell-portals";

// Unmatched URLs render against the root layout, outside (operator)/layout.tsx,
// so this page brings the application shell itself. It links to Home (home spec).
export default async function NotFound() {
  const { theme, sidebar, portal } = await shellPreferences();
  const nav = navFlags();
  const home = homeLink(visibleGroups(nav));
  return (
    <AppShell theme={theme} sidebar={sidebar} nav={nav} portals={shellPortals(nav, portal)}>
      <NotFoundPage noun="Page" listHref={home.href} listLabel={home.label} />
    </AppShell>
  );
}
