"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { locate, visibleSections } from "./navigation";
import { SIDEBAR_ID } from "./shell-header";
import styles from "./sidebar-nav.module.css";

const SECTIONS_ID = "sidebar-sections";

/** Closes the sidebar's drawer, if it is open as one. */
function closeDrawer(): void {
  const drawer = document.getElementById(SIDEBAR_ID);
  if (drawer?.matches(":popover-open")) drawer.hidePopover();
}

/**
 * The sidebar's navigation (operator-interface/page-patterns spec): within a
 * section it shows that section's sub-menu, headed by the section's name, with
 * the page's item marked current; Show all sections returns to the section
 * menu without leaving the page. Both menus are always rendered and only one
 * is displayed. Without JavaScript, Show all sections links to the section
 * menu, and a :target rule displays it; with JavaScript, it switches in place
 * and moves focus to the current section. Every navigation shows the new
 * page's sub-menu again.
 */
export function SidebarNav({ demo }: { demo: boolean }) {
  const pathname = usePathname();
  const located = locate(pathname, demo);
  const [shownFor, setShownFor] = useState(pathname);
  const [allSections, setAllSections] = useState(false);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setAllSections(false);
  }
  const currentSection = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (allSections) currentSection.current?.focus();
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

  const view = !located || allSections ? "sections" : "submenu";
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
      <ul id={SECTIONS_ID} className={styles.sections} tabIndex={-1}>
        {visibleSections(demo).map((section) => {
          const current = located?.section.id === section.id;
          return (
            <li key={section.id}>
              <Link href={section.items[0]!.href} ref={current ? currentSection : undefined} className={styles.item} aria-current={current ? "true" : undefined} data-section={section.id}>
                <Icon name={section.icon} className={styles.icon} />
                <span className={styles.label}>{section.label}</span>
                <Icon name="chevronRight" size={14} className={styles.chevron} />
              </Link>
            </li>
          );
        })}
      </ul>
      {located && (
        <div className={styles.submenu}>
          <div className={styles.head}>
            <a
              href={`#${SECTIONS_ID}`}
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
            <p id="sidebar-section-title" className={styles.heading}>
              {located.section.label}
            </p>
          </div>
          <ul className={styles.list} aria-labelledby="sidebar-section-title">
            {located.section.items.map((item) => (
              <li key={item.id}>
                <Link href={item.href} className={styles.item} aria-current={item.id === located.item.id ? "page" : undefined} data-item={item.id}>
                  <span className={styles.label}>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
