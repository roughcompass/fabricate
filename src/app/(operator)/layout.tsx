import { AppShell } from "@/components/shell/app-shell";
import { navFlags } from "@/components/shell/nav-flags";
import { shellPreferences } from "@/components/shell/shell-preferences";

/**
 * Every operator page renders inside the application shell. The `header`
 * slot (./@header) is the shell header: the same on every page but the
 * focused ones, whose header holds a back button.
 */
export default async function OperatorLayout({ children, header }: LayoutProps<"/">) {
  const { theme, sidebar } = await shellPreferences();
  const nav = navFlags();
  return (
    <AppShell theme={theme} sidebar={sidebar} nav={nav} header={header}>
      {children}
    </AppShell>
  );
}
