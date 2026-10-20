"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { BRANDS } from "@/lib/demo/catalog";
import { Icon, type IconName } from "./members/icons";
import { useCurrentRoute, useRouteHref, useRuntime } from "./runtime-context";
import { ENVIRONMENT_LABELS, HeaderActions, PortalRoot, UserMenu } from "./shell-parts";
import styles from "./access-shell.module.css";

const NARROW = "(max-width: 767px)";

function subscribeNarrow(listener: () => void) {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Whether the screen is narrow enough that the navigation is a drawer. */
function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
}

/** A navigation group that expands and collapses, with the entries it lists. */
function NavGroup({ icon, label, defaultOpen = false, children }: { icon: IconName; label: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <li>
      <button type="button" className={styles.groupButton} aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <Icon name={icon} size={18} />
        <span className={styles.itemLabel}>{label}</span>
        <span className={styles.groupChevron}>
          <Icon name="chevronDown" size={14} />
        </span>
      </button>
      <ul id={id} className={styles.subList} hidden={!open}>
        {children}
      </ul>
    </li>
  );
}

/**
 * The J.P. Morgan Access shell, for Payments, Global Banking, and Other
 * applications (portal-runtime spec): a white header with the menu control,
 * the J.P. Morgan logo and portal name, and, at its right end, search, notifications, help, and
 * the user menu; a left navigation with Home, the application's routes,
 * Reports and Insights, and Support Hub; and breadcrumbs above the page title.
 * On narrow screens the navigation is a drawer the menu control opens.
 */
export function AccessShell({ children }: { children: React.ReactNode }) {
  const { descriptor, template, app } = useRuntime();
  const current = useCurrentRoute();
  const routeHref = useRouteHref();
  const narrow = useNarrow();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const navigation = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const navId = useId();
  const brand = BRANDS[template.brand];
  const start = app.routes[0]!;
  const expanded = narrow ? drawer : !collapsed;

  useEffect(() => {
    if (!drawer) return;
    navigation.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [drawer]);

  const closeDrawer = () => {
    setDrawer(false);
    menuButton.current?.focus();
  };

  return (
    <PortalRoot className={styles.portal}>
      <header className={styles.header} data-demo-anchor="portal-header">
        <button
          ref={menuButton}
          type="button"
          className={styles.menuButton}
          aria-label={expanded ? "Hide navigation" : "Show navigation"}
          title={expanded ? "Hide navigation" : "Show navigation"}
          aria-expanded={expanded}
          aria-controls={navId}
          onClick={() => (narrow ? setDrawer((value) => !value) : setCollapsed((value) => !value))}
        >
          <Icon name="menu" size={20} />
        </button>
        <Link href={routeHref(start)} className={styles.wordmark}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed SVG from DE FabLab\'s own origin */}
          <img className={styles.logo} src="/brand/jpmorgan-logo.svg" alt="J.P. Morgan" />
          <span className={styles.wordmarkDivider} aria-hidden="true" />
          <span className={styles.wordmarkProduct}>Access</span>
        </Link>
        <div className={styles.actions}>
          <HeaderActions portal={brand.portalName} />
          <UserMenu />
        </div>
      </header>

      <div className={styles.body} data-collapsed={collapsed || undefined}>
        {narrow && drawer && <button type="button" className={styles.backdrop} aria-label="Close navigation" onClick={closeDrawer} />}
        <nav
          ref={navigation}
          id={navId}
          aria-label={`${brand.portalName} navigation`}
          className={styles.nav}
          data-drawer={narrow ? (drawer ? "open" : "closed") : undefined}
          onKeyDown={(event) => {
            if (event.key === "Escape" && narrow && drawer) {
              event.stopPropagation();
              closeDrawer();
            }
          }}
        >
          <ul className={styles.navList}>
            <li>
              <Link href={routeHref(start)} className={styles.item} onClick={() => setDrawer(false)}>
                <Icon name="home" size={18} />
                <span className={styles.itemLabel}>Home</span>
              </Link>
            </li>
            <NavGroup icon="folder" label={descriptor.applicationName} defaultOpen>
              {app.routes.map((route) => (
                <li key={route.path}>
                  <Link
                    href={routeHref(route)}
                    className={styles.subItem}
                    aria-current={route.path === current.path ? "page" : undefined}
                    data-demo-anchor={`nav-${route.path}`}
                    onClick={() => setDrawer(false)}
                  >
                    {route.label}
                  </Link>
                </li>
              ))}
            </NavGroup>
            <NavGroup icon="chart" label="Reports and Insights">
              <li className={styles.staticItem}>Statements</li>
              <li className={styles.staticItem}>Analytics</li>
            </NavGroup>
            <NavGroup icon="lifebuoy" label="Support Hub">
              <li className={styles.staticItem}>Guides</li>
              <li className={styles.staticItem}>Contact us</li>
            </NavGroup>
          </ul>
        </nav>

        <div className={styles.content}>
          <main className={styles.main}>
            <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
              <ol className={styles.crumbs}>
                {/* The brand has no page of its own in the demo, so its crumb is plain text. */}
                <li className={styles.crumb}>{brand.label}</li>
                <li className={styles.crumb}>
                  <Link href={routeHref(start)} className={styles.crumbLink}>
                    {descriptor.applicationName}
                  </Link>
                </li>
                <li className={styles.crumb} aria-current="page">
                  {current.label}
                </li>
              </ol>
            </nav>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{current.label}</h1>
              <p className={styles.tagline}>{brand.tagline}</p>
            </div>
            {children}
          </main>
          <footer className={styles.footer} data-demo-anchor="portal-footer">
            <span>{`An illustrative ${brand.portalName} shell for the template demo. All data is fictional.`}</span>
            <span>{`Environment: ${ENVIRONMENT_LABELS[descriptor.environment]}`}</span>
          </footer>
        </div>
      </div>
    </PortalRoot>
  );
}
