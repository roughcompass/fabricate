import { selectPortalAction } from "@/app/portal-actions";
import { createPortalAction } from "@/app/(operator)/portals/actions";
import { CreatePortalDialog } from "@/components/onboarding/create-portal";
import type { SwitcherPortal } from "@/lib/onboarding/catalog";
import type { WhatsIncluded } from "@/lib/onboarding/whats-included";
import type { Theme } from "@/lib/web/theme";
import { SIDEBAR_WIDTH } from "@/lib/web/sidebar";
import { BrandLink } from "./brand-link";
import { NO_OPTIONAL_AREAS, type NavFlags, homeLink, visibleGroups } from "./navigation";
import { NavigationFeedback } from "./navigation-feedback";
import { PortalSwitcher } from "./portal-switcher";
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
 * The sidebar's Portal switcher and the Create Portal dialog: the Portals it
 * lists, the current one's public ID or null for All Portals, and the
 * What's included content or null.
 */
export interface ShellPortals {
  readonly list: readonly SwitcherPortal[];
  readonly current: string | null;
  readonly included: WhatsIncluded | null;
}

/**
 * The frame around every page (operator-interface/page-patterns spec): a skip
 * link; a full-height sidebar with the product mark, the navigation, and the
 * theme control; and the content column, which holds the main region. Below
 * 1024px the sidebar is a drawer instead. The sidebar's width and hidden
 * state come from the operator's cookies, so the first paint already has
 * them. Applications and Salt Patterns appear in the navigation only while
 * the template demo is enabled, Prototypes only while it is enabled, and the
 * hosted profile shows Prototypes alone. The product mark opens Home, or
 * wherever links to Home lead in this configuration. Beside it, the Portal
 * switcher takes the product name's place while Web Onboarding is shown
 * (portal-switcher spec), and the Create Portal dialog is mounted for it to
 * open; the layout passes `portals` only then.
 */
export function AppShell({ theme, nav = NO_OPTIONAL_AREAS, sidebar = DEFAULT_SIDEBAR, portals = null, children }: { theme: Theme; nav?: NavFlags; sidebar?: SidebarPreferences; portals?: ShellPortals | null; children: React.ReactNode }) {
  return (
    <>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <div className={styles.shell} data-sidebar={sidebar.hidden ? "hidden" : "shown"} style={{ "--_sidebar-width": `${sidebar.width}px` } as React.CSSProperties}>
        {/* Inline from 1024px; below that, a native popover drawer that the header's Open navigation opens. */}
        <div id={SIDEBAR_ID} className={styles.sidebar} popover="auto">
          <div className={styles.brandRow}>
            <BrandLink href={homeLink(visibleGroups(nav)).href} className={styles.brand} aria-label="DE FabLab home" title={portals ? "DE FabLab home" : undefined}>
              <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 2 22 20H2L12 2z" fill="currentColor" />
              </svg>
              {!portals && <span className={styles.name}>DE FabLab</span>}
            </BrandLink>
            {portals && (
              <div className={styles.portalSwitcher}>
                <PortalSwitcher portals={portals.list} current={portals.current} action={selectPortalAction} />
              </div>
            )}
            <span className={styles.hideSidebar}>
              <SidebarToggle to="hidden" />
            </span>
          </div>
          <SidebarNav nav={nav} portals={portals?.list} />
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
          {portals && <CreatePortalDialog action={createPortalAction} included={portals.included} />}
        </div>
      </div>
    </>
  );
}
