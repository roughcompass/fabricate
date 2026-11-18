import { AppShell } from "@/components/shell/app-shell";
import { navFlags } from "@/components/shell/nav-flags";
import { shellPreferences } from "@/components/shell/shell-preferences";

/** Every operator page renders inside the application shell. */
export default async function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { theme, sidebar } = await shellPreferences();
  const nav = navFlags();
  return (
    <AppShell theme={theme} sidebar={sidebar} nav={nav}>
      {children}
    </AppShell>
  );
}
