"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import type { SwitcherPortal } from "@/lib/onboarding/catalog";
import { HOME, type MenuGroup, type NavFlags, RUNTIME_CONFIGURATION, homeLink, locate, visibleGroups } from "./navigation";
import { runtimeMenu } from "./runtime-menu";
import { SIDEBAR_ID } from "./shell-header";
import styles from "./sidebar-nav.module.css";

const MENU_ID = "sidebar-sections";

/** Closes the sidebar's drawer, if it is open as one. */
export function closeDrawer(): void {
  const drawer = document.getElementById(SIDEBAR_ID);
  if (drawer?.matches(":popover-open")) drawer.hidePopover();
}

/** The groups shown, without Home where links to Home lead elsewhere. */
function shownGroups(nav: NavFlags): readonly MenuGroup[] {
  const groups = visibleGroups(nav);
  const showHome = homeLink(groups).href === HOME.href;
  return groups.map((group) => ({ ...group, items: group.items.filter((item) => item.id !== HOME.id || showHome) }));
}

/**
 * The sidebar's navigation (operator-interface/page-patterns spec). The
 * primary menu lists Home, Applications, and Runtime Configuration, then the
 * Assessments and Salt Patterns & Prototypes groups, each under a heading and
 * set apart by a divider, with every page listed inline. Runtime
 * Configuration alone drills in: on its pages the sidebar shows its sub-menu
 * (runtime-configuration spec), and Show all sections returns to the primary
 * menu without leaving the page. Both menus are always rendered and only one
 * is displayed. Without JavaScript, Show all sections links to the primary
 * menu, and a :target rule displays it; with JavaScript, it switches in place
 * and moves focus to Runtime Configuration. Every navigation shows the new
 * page's menu again.
 */
export function SidebarNav({ nav, portals = [] }: { nav: NavFlags; portals?: readonly SwitcherPortal[] }) {
  const pathname = usePathname();
  const located = locate(pathname, nav);
  const [shownFor, setShownFor] = useState(pathname);
  const [allSections, setAllSections] = useState(false);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setAllSections(false);
  }
  const runtimeItem = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (allSections) runtimeItem.current?.focus();
  }, [allSections]);

  // Below 1024px the sidebar is a drawer: it closes when a page opens, and when the viewport widens to show it inline.
  useEffect(() => closeDrawer(), [pathname]);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (wide.matches) closeDrawer();
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  const inRuntime = located?.item.id === RUNTIME_CONFIGURATION.id;
  const submenu = inRuntime ? runtimeMenu(pathname, (id) => portals.find((portal) => portal.publicId === id)?.label ?? null) : null;
  const view = !submenu || allSections ? "menu" : "submenu";
  return (
    <nav
      aria-label="Primary"
      className={styles.nav}
      data-view={view}
      // Choosing an item closes the drawer, including when the page stays the same.
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a[href]:not([href^='#'])")) closeDrawer();
      }}
    >
      <div id={MENU_ID} className={styles.menu} tabIndex={-1}>
        {shownGroups(nav).map((group, index) => {
          const headingId = `sidebar-group-${group.id}`;
          return (
            <Fragment key={group.id}>
              {index > 0 && <hr className={styles.divider} />}
              {group.heading && (
                <p id={headingId} className={styles.groupHeading}>
                  {group.heading}
                </p>
              )}
              <ul className={styles.list} aria-labelledby={group.heading ? headingId : undefined} data-group={group.id}>
                {group.items.map((item) => {
                  const current = located?.item.id === item.id;
                  const drills = item.id === RUNTIME_CONFIGURATION.id;
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        ref={drills ? runtimeItem : undefined}
                        className={styles.item}
                        // An item's own address is its page; any page under it is part of it.
                        aria-current={current ? (pathname === item.href ? "page" : "true") : undefined}
                        data-item={item.id}
                      >
                        <Icon name={item.icon} className={styles.icon} />
                        <span className={styles.label}>{item.label}</span>
                        {drills && <Icon name="chevronRight" size={14} className={styles.chevron} />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Fragment>
          );
        })}
      </div>
      {submenu && (
        <div className={styles.submenu}>
          <div className={styles.head}>
            <a
              href={`#${MENU_ID}`}
              className={styles.back}
              aria-label="Show all sections"
              title="Show all sections"
              onClick={(event) => {
                event.preventDefault();
                setAllSections(true);
              }}
            >
              <Icon name="chevronLeft" />
            </a>
            <p id="sidebar-submenu-title" className={styles.heading}>
              {RUNTIME_CONFIGURATION.label}
            </p>
          </div>
          {submenu.groups.map((group, index) => {
            // The first group is named by the sub-menu's heading; each later group by its own.
            const headingId = index === 0 ? "sidebar-submenu-title" : `sidebar-submenu-${group.id}`;
            return (
              <div key={group.id} className={styles.group} data-group={group.id}>
                {index > 0 && group.heading && (
                  <p id={headingId} className={styles.groupHeading} title={group.heading}>
                    {group.heading}
                  </p>
                )}
                <ul className={styles.list} aria-labelledby={headingId}>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <Link href={item.href} className={styles.item} aria-current={item.id === submenu.current ? "page" : undefined} data-item={item.id}>
                        <span className={styles.label}>{item.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}
