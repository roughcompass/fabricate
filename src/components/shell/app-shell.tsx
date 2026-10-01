import Link from "next/link";
import type { Theme } from "@/lib/web/theme";
import { SIDEBAR_WIDTH } from "@/lib/web/sidebar";
import { NavigationFeedback } from "./navigation-feedback";
import { SIDEBAR_ID } from "./shell-header";
import { SidebarNav } from "./sidebar-nav";
import { SidebarResizer } from "./sidebar-resizer";
import { SidebarToggle } from "./sidebar-toggle";
import { ThemeSwitcher } from "./theme-switcher";
import styles from "./app-shell.module.css";

export interface SidebarPreferences {
  readonly width: number;
  readonly hidden: boolean;
}

const DEFAULT_SIDEBAR: SidebarPreferences = { width: SIDEBAR_WIDTH.default, hidden: false };

/**
 * The frame around every page (operator-interface/page-patterns spec): a skip
 * link; a full-height sidebar with the product mark, the navigation, and the
 * theme control; and the content column, which holds the main region. Below
 * 1024px the sidebar is a drawer instead. The sidebar's width and hidden
 * state come from the operator's cookies, so the first paint already has
 * them. Applications and Salt Patterns appear in the navigation only while
 * the template demo is enabled.
 */
export function AppShell({ theme, demo = false, sidebar = DEFAULT_SIDEBAR, children }: { theme: Theme; demo?: boolean; sidebar?: SidebarPreferences; children: React.ReactNode }) {
  return (
    <>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <div className={styles.shell} data-sidebar={sidebar.hidden ? "hidden" : "shown"} style={{ "--_sidebar-width": `${sidebar.width}px` } as React.CSSProperties}>
        {/* Inline from 1024px; below that, a native popover drawer that the header's Open navigation opens. */}
        <div id={SIDEBAR_ID} className={styles.sidebar} popover="auto">
          <div className={styles.brandRow}>
            <Link href="/assessments" className={styles.brand} aria-label="DE FabLab home">
              <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 2 22 20H2L12 2z" fill="currentColor" />
              </svg>
              <span className={styles.name}>DE FabLab</span>
            </Link>
            <span className={styles.hideSidebar}>
              <SidebarToggle to="hidden" />
            </span>
          </div>
          <SidebarNav demo={demo} />
          <div className={styles.footer}>
            <span className={styles.footerLabel} aria-hidden="true">
              Theme
            </span>
            <ThemeSwitcher current={theme} />
          </div>
          <SidebarResizer initialWidth={sidebar.width} />
        </div>
        <div className={styles.column}>
          <main id="main" className={styles.main} tabIndex={-1}>
            <NavigationFeedback>{children}</NavigationFeedback>
          </main>
        </div>
      </div>
    </>
  );
}
