"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { HOME, type NavFlags, homeLink, locate, visibleSections, visibleTopLevel } from "./navigation";
import { SIDEBAR_ID } from "./shell-header";
import styles from "./sidebar-nav.module.css";

const SECTIONS_ID = "sidebar-sections";

/** Closes the sidebar's drawer, if it is open as one. */
export function closeDrawer(): void {
  const drawer = document.getElementById(SIDEBAR_ID);
  if (drawer?.matches(":popover-open")) drawer.hidePopover();
}

/**
 * The sidebar's navigation (operator-interface/page-patterns spec): the
 * section menu leads with the top-level items, Home, Applications, and
 * Navigation, which have no sub-menu, so their pages keep the section menu
 * with the item marked current. Within a section it shows that section's
 * sub-menu, headed by the section's name, with the page's item marked
 * current; Show all sections returns to the section menu without leaving the
 * page. Both menus are always rendered and only one
 * is displayed. Without JavaScript, Show all sections links to the section
 * menu, and a :target rule displays it; with JavaScript, it switches in place
 * and moves focus to the current section. Every navigation shows the new
 * page's sub-menu again.
 */
export function SidebarNav({ nav }: { nav: NavFlags }) {
  const pathname = usePathname();
  const located = locate(pathname, nav);
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

  const section = located?.kind === "section" ? located : null;
  const view = !section || allSections ? "sections" : "submenu";
  const sections = visibleSections(nav);
  // The top-level items lead the section menu; they have no sub-menu, so no chevron. Home is among them while it's available.
  const showHome = homeLink(sections).href === HOME.href;
  const topLevel = visibleTopLevel(nav).filter((item) => item.id !== HOME.id || showHome);
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
        {topLevel.map((item) => {
          const current = located?.kind === "item" && located.item.id === item.id;
          // A top-level item's own address is its page; any page under it is part of it.
          return (
            <li key={item.id}>
              <Link href={item.href} className={styles.item} aria-current={current ? (pathname === item.href ? "page" : "true") : undefined} data-item={item.id}>
                <Icon name={item.icon} className={styles.icon} />
                <span className={styles.label}>{item.label}</span>
              </Link>
            </li>
          );
        })}
        {sections.map((candidate) => {
          const current = section?.section.id === candidate.id;
          return (
            <li key={candidate.id}>
              <Link href={candidate.items[0]!.href} ref={current ? currentSection : undefined} className={styles.item} aria-current={current ? "true" : undefined} data-section={candidate.id}>
                <Icon name={candidate.icon} className={styles.icon} />
                <span className={styles.label}>{candidate.label}</span>
                <Icon name="chevronRight" size={14} className={styles.chevron} />
              </Link>
            </li>
          );
        })}
      </ul>
      {section && (
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
              {section.section.label}
            </p>
          </div>
          {/* The first group is named by the section heading; each later group by its own. */}
          {section.section.groups.map((group, index) => {
            const headingId = index === 0 ? "sidebar-section-title" : `sidebar-group-${section.section.id}-${index}`;
            return (
              <div key={group.label ?? section.section.id} className={styles.group}>
                {index > 0 && (
                  <p id={headingId} className={styles.groupHeading}>
                    {group.label}
                  </p>
                )}
                <ul className={styles.list} aria-labelledby={headingId}>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <Link href={item.href} className={styles.item} aria-current={item.id === section.item.id ? "page" : undefined} data-item={item.id}>
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
