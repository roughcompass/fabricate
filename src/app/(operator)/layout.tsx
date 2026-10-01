import { AppShell } from "@/components/shell/app-shell";
import { shellPreferences } from "@/components/shell/shell-preferences";
import { getConfig } from "@/lib/config";

/** Every operator page renders inside the application shell. */
export default async function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { theme, sidebar } = await shellPreferences();
  return (
    <AppShell theme={theme} sidebar={sidebar} demo={getConfig().demoEnabled}>
      {children}
    </AppShell>
  );
}
