import { AppShell } from "@/components/shell/app-shell";
import { homeLink, visibleSections } from "@/components/shell/navigation";
import { shellPreferences } from "@/components/shell/shell-preferences";
import { NotFoundPage } from "@/components/shell/system-page";
import { getConfig } from "@/lib/config";

// Unmatched URLs render against the root layout, outside (operator)/layout.tsx,
// so this page brings the application shell itself. It links to Home (home spec).
export default async function NotFound() {
  const { theme, sidebar } = await shellPreferences();
  const demo = getConfig().demoEnabled;
  const home = homeLink(visibleSections(demo));
  return (
    <AppShell theme={theme} sidebar={sidebar} demo={demo}>
      <NotFoundPage noun="Page" listHref={home.href} listLabel={home.label} />
    </AppShell>
  );
}
