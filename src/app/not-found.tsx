import { AppShell } from "@/components/shell/app-shell";
import { shellPreferences } from "@/components/shell/shell-preferences";
import { NotFoundPage } from "@/components/shell/system-page";
import { getConfig } from "@/lib/config";

// Unmatched URLs render against the root layout, outside (operator)/layout.tsx,
// so this page brings the application shell itself.
export default async function NotFound() {
  const { theme, sidebar } = await shellPreferences();
  return (
    <AppShell theme={theme} sidebar={sidebar} demo={getConfig().demoEnabled}>
      <NotFoundPage noun="Page" listHref="/assessments" listLabel="Assessments" />
    </AppShell>
  );
}
