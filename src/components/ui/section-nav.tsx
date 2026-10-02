"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icon";
import { type Tone, statusOf } from "./status";
import styles from "./section-nav.module.css";

export interface NavGroup {
  label: string;
  items: readonly { id: string; label: string; state?: string }[];
}

/**
 * Navigation to the sections of a long page, with each section's state. It
 * stays in view beside the content on wide screens and collapses into a
 * disclosure on narrow ones; the section in view is marked as current.
 */
export function SectionNav({ label, groups, jumpLabel = "Jump to a section" }: { label: string; groups: readonly NavGroup[]; jumpLabel?: string }) {
  const ids = groups.flatMap((group) => group.items.map((item) => item.id));
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const sections = ids.map((id) => document.getElementById(id)).filter((element): element is HTMLElement => element !== null);
    if (!sections.length) return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
        const first = ids.find((id) => visible.get(id));
        if (first) setCurrent(first);
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );
    for (const section of sections) observer.observe(section);
    const onHash = () => setCurrent(decodeURIComponent(window.location.hash.slice(1)) || null);
    window.addEventListener("hashchange", onHash);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", onHash);
    };
  }, [ids.join(" ")]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = (
    <ol className={styles.groups}>
      {groups.map((group) => (
        <li key={group.label}>
          <p className={styles.group}>{group.label}</p>
          <ol className={styles.items}>
            {group.items.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className={styles.link} aria-current={current === item.id ? "location" : undefined} onClick={() => setCurrent(item.id)}>
                  {item.state && <span className={styles.dot} data-tone={statusOf(item.state).tone satisfies Tone} data-indicator={statusOf(item.state).indicator} aria-hidden="true" />}
                  <span className={styles.label}>{item.label}</span>
                  {item.state && <span className="visually-hidden">{`, ${statusOf(item.state).label}`}</span>}
                </a>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );

  return (
    <nav aria-label={label} className={styles.nav}>
      <div className={styles.wide}>{list}</div>
      <details className={styles.narrow}>
        <summary className={styles.summary}>
          <Icon name="chevronRight" size={14} className={styles.chevron} />
          {jumpLabel}
        </summary>
        {list}
      </details>
    </nav>
  );
}
