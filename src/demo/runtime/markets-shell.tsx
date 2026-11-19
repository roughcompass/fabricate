"use client";

import Link from "next/link";
import { BRANDS, TEMPLATES } from "@/lib/demo/catalog";
import { useCurrentRoute, useRouteHref, useRuntime } from "./runtime-context";
import { ENVIRONMENT_LABELS, HeaderActions, HeaderMenu, MenuList, PortalRoot, UserMenu } from "./shell-parts";
import styles from "./markets-shell.module.css";

/** Sections of the portal beside the application; only the application itself is part of the demo. */
const SECTIONS = ["Home", "Research", "Data & Analytics"] as const;
const FOOTER_LINKS = ["Terms of Use", "Disclosures", "Security", "Privacy", "Cookies Policy", "Contact Us"] as const;

/**
 * The J.P. Morgan Markets shell, for Markets applications (portal-runtime
 * spec): a top bar with the application switcher, the J.P. Morgan logo, primary
 * tabs marked along their top edge, and the user menu; a second row with the
 * application's routes, the current one underlined; a dark title band with
 * the page title in a serif face; and a footer of legal links.
 */
export function MarketsShell({ children }: { children: React.ReactNode }) {
  const { descriptor, template, app } = useRuntime();
  const current = useCurrentRoute();
  const routeHref = useRouteHref();
  const brand = BRANDS[template.brand];
  const start = app.routes[0]!;
  const applications = TEMPLATES.filter((entry) => entry.brand === "markets").map((entry) => entry.title);

  return (
    <PortalRoot className={styles.portal}>
      <header className={styles.header} data-demo-anchor="portal-header">
        <div className={styles.topBar}>
          <HeaderMenu label="Switch applications" icon="grid" align="start">
            <MenuList title="Markets applications" items={[descriptor.applicationName, ...applications.filter((title) => title !== descriptor.applicationName)].map((title) => ({ primary: title, current: title === descriptor.applicationName, secondary: title === descriptor.applicationName ? "This application" : undefined }))} />
          </HeaderMenu>
          <Link href={routeHref(start)} className={styles.wordmark}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a fixed SVG from the Frontend Registry\'s own origin */}
            <img className={styles.logo} src="/brand/jpmorgan-logo.svg" alt="J.P. Morgan" />
            <span className={styles.wordmarkProduct}>Markets</span>
          </Link>
          <nav aria-label={`${brand.portalName} sections`} className={styles.sections} data-scroll-x="">
            <ul className={styles.sectionList}>
              {SECTIONS.map((section) => (
                <li key={section} className={styles.section}>
                  {section}
                </li>
              ))}
              <li className={styles.section}>
                <Link href={routeHref(start)} className={styles.sectionLink} aria-current="page">
                  {descriptor.applicationName}
                </Link>
              </li>
            </ul>
          </nav>
          <div className={styles.actions}>
            <HeaderActions portal={brand.portalName} />
            <UserMenu />
          </div>
        </div>
        <nav aria-label={`${brand.portalName} navigation`} className={styles.routes} data-scroll-x="">
          <ul className={styles.routeList}>
            {app.routes.map((route) => (
              <li key={route.path}>
                <Link href={routeHref(route)} className={styles.routeLink} aria-current={route.path === current.path ? "page" : undefined} data-demo-anchor={`nav-${route.path}`}>
                  {route.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <div className={styles.band}>
        <div className={styles.bandInner}>
          <p className={styles.bandEyebrow}>{descriptor.applicationName}</p>
          <h1 className={styles.title}>{current.label}</h1>
          <p className={styles.tagline}>{brand.tagline}</p>
        </div>
      </div>

      <main className={styles.main}>{children}</main>

      <footer className={styles.footer} data-demo-anchor="portal-footer" id="portal-footer">
        <div className={styles.footerRow}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed SVG from the Frontend Registry\'s own origin */}
          <img className={styles.logo} src="/brand/jpmorgan-logo.svg" alt="J.P. Morgan" />
          <ul className={styles.footerLinks} aria-label="Legal">
            {/* Illustrative entries: plain text, since the demo has no such pages (page-patterns spec, placeholder links). */}
            {FOOTER_LINKS.map((label) => (
              <li key={label} className={styles.footerItem}>
                {label}
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.footerRow}>
          <span>{`An illustrative ${brand.portalName} shell for the template demo. All data is fictional.`}</span>
          <span>{`Environment: ${ENVIRONMENT_LABELS[descriptor.environment]}`}</span>
        </div>
      </footer>
    </PortalRoot>
  );
}
