"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect } from "react";
import { Icon } from "@/components/ui/icon";
import { type NavFlags, locate, visibleGroups } from "./navigation";
import { SIDEBAR_ID } from "./shell-header";
import styles from "./sidebar-nav.module.css";

/** Closes the sidebar's drawer, if it is open as one. */
export function closeDrawer(): void {
  const drawer = document.getElementById(SIDEBAR_ID);
  if (drawer?.matches(":popover-open")) drawer.hidePopover();
}


/**
 * The sidebar's navigation (operator-interface/page-patterns spec). The
 * primary menu lists Home, then the Registry, Assessments, Templates,
 * Insights, and Admin groups, each under a heading and set apart by a
 * divider, with every page listed inline.
 */
export function SidebarNav({ nav }: { nav: NavFlags }) {
  const pathname = usePathname();
  const located = locate(pathname, nav);

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

  return (
    <nav
      aria-label="Primary"
      className={styles.nav}
      // Choosing an item closes the drawer, including when the page stays the same.
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a[href]:not([href^='#'])")) closeDrawer();
      }}
    >
      <div className={styles.menu}>
        {visibleGroups(nav).map((group, index) => {
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
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        className={styles.item}
                        // An item's own address is its page; any page under it is part of it.
                        aria-current={current ? (pathname === item.href ? "page" : "true") : undefined}
                        data-item={item.id}
                      >
                        <Icon name={item.icon} className={styles.icon} />
                        <span className={styles.label}>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}
