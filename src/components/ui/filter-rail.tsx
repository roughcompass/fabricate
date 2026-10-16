"use client";

import Form from "next/form";
import Link from "next/link";
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { buttonProps } from "./button-content";
import { formStyles } from "./form";
import { Icon } from "./icon";
import styles from "./filter-rail.module.css";
import menuStyles from "./menu.module.css";

const subscribeNever = () => () => {};

export interface FilterRailGroup {
  /** The query parameter; each checked option adds one value. */
  name: string;
  legend: string;
  options: readonly { value: string; label: string; count: number; disabled?: boolean }[];
}

interface FilterRailProps {
  /** The page the filters apply to; the checked options become its query. */
  action: string;
  /** The form's accessible name, and its heading unless `title` is given. */
  label: string;
  title?: string;
  headingLevel?: 2 | 3;
  groups: readonly FilterRailGroup[];
  selected: Readonly<Record<string, readonly string[]>>;
  /** Query values to keep, such as the search. */
  keep?: Record<string, string>;
  /** Number of checked options, shown on the narrow-screen disclosure. */
  activeCount: number;
  /** Whether any filter or search is active, which shows Clear. */
  filtered: boolean;
  clearHref: string;
}

/**
 * Check box filters in a rail beside the results on wide screens, and in a
 * collapsible Filters disclosure above them on narrow ones. The rail has a
 * heading with a Clear action; each group collapses and shows how many of its
 * options are checked; each option is a tinted row with how many results it
 * would match. With JavaScript a change applies immediately; without it, the
 * Apply button submits. The filters live in the URL.
 */
export function FilterRail({ action, label, title = label, headingLevel = 2, groups, selected, keep = {}, activeCount, filtered, clearHref }: FilterRailProps) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <Form action={action} scroll={false} className={styles.rail} aria-label={label} onChange={(event) => event.currentTarget.requestSubmit()}>
      {Object.entries(keep).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <details className={styles.disclosure}>
        <summary className={styles.summary}>
          <Icon name="chevronRight" size={14} className={styles.chevron} />
          Filters
          {activeCount > 0 && (
            <span className={styles.badge}>
              {activeCount}
              <span className="visually-hidden"> active</span>
            </span>
          )}
        </summary>
        <div className={styles.content}>
          <div className={styles.head}>
            <Heading className={styles.title}>{title}</Heading>
            {filtered && (
              <Link href={clearHref} {...buttonProps("tertiary", "sm")} scroll={false}>
                Clear
              </Link>
            )}
          </div>
          {groups.map((group) => {
            const checked = group.options.filter((option) => selected[group.name]?.includes(option.value)).length;
            return (
              <details key={group.name} className={styles.group} open>
                <summary className={styles.groupSummary}>
                  <Icon name="chevronRight" size={14} className={styles.groupChevron} />
                  <span className={styles.groupName}>{group.legend}</span>
                  {checked > 0 && <span className={styles.selectedCount}>{`${checked} selected`}</span>}
                </summary>
                <fieldset className={styles.options}>
                  <legend className="visually-hidden">{group.legend}</legend>
                  {group.options.map((option) => (
                    <label key={option.value} className={styles.option}>
                      <input
                        type="checkbox"
                        className={formStyles.checkbox}
                        name={group.name}
                        value={option.value}
                        defaultChecked={selected[group.name]?.includes(option.value)}
                        disabled={option.disabled}
                      />
                      <span className={styles.optionLabel}>{option.label}</span>
                      <span className={styles.count}>{option.count}</span>
                    </label>
                  ))}
                </fieldset>
              </details>
            );
          })}
          <div className={styles.actions}>
            <button type="submit" {...buttonProps("secondary", "sm")} hidden={hydrated}>
              Apply
            </button>
          </div>
        </div>
      </details>
    </Form>
  );
}

/** Check box groups, each in its own fieldset, as both the rail and the menu show them. */
function FilterGroups({ groups, selected, counts = true }: { groups: readonly FilterRailGroup[]; selected: Readonly<Record<string, readonly string[]>>; counts?: boolean }) {
  return groups.map((group) => (
    <fieldset key={group.name} className={styles.menuGroup}>
      <legend className={styles.menuLegend}>{group.legend}</legend>
      <div className={styles.options}>
        {group.options.map((option) => (
          <label key={option.value} className={styles.option}>
            <input type="checkbox" className={formStyles.checkbox} name={group.name} value={option.value} defaultChecked={selected[group.name]?.includes(option.value)} disabled={option.disabled} />
            <span className={styles.optionLabel}>{option.label}</span>
            {counts && <span className={styles.count}>{option.count}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  ));
}

/**
 * The same check box filters behind a Filter button, for a page whose
 * results fill its width, such as the Applications page (design-system
 * docs, "Filters"). The button shows how many options are checked and opens
 * a native popover, so it works without JavaScript; with JavaScript a change
 * applies immediately, and without it the Apply button submits. The filters
 * live in the URL.
 */
export function FilterMenu({ action, label, groups, selected, keep = {}, activeCount, filtered, clearHref, counts = true, align = "end" }: Omit<FilterRailProps, "title" | "headingLevel"> & { counts?: boolean; align?: "start" | "end" }) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const id = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const popover = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = popover.current;
    if (!element || CSS.supports("position-area: bottom")) return;
    // Without anchor positioning, place the panel below its trigger by measurement.
    const place = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open" || !trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      element.style.top = `${rect.bottom + 4}px`;
      element.style.left = `${align === "end" ? Math.max(8, rect.right - element.offsetWidth) : rect.left}px`;
    };
    element.addEventListener("toggle", place);
    return () => element.removeEventListener("toggle", place);
  }, [align]);

  return (
    <>
      <button ref={trigger} type="button" popoverTarget={`filter-${id}`} {...buttonProps("secondary", "md")} aria-label={activeCount > 0 ? `Filter, ${activeCount} active` : "Filter"} style={{ anchorName: `--filter-${id}` } as React.CSSProperties}>
        <Icon name="filter" />
        Filter
        {activeCount > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {activeCount}
          </span>
        )}
      </button>
      <div ref={popover} id={`filter-${id}`} popover="auto" className={`${menuStyles.menu} ${styles.menuPanel}`} data-align={align} style={{ positionAnchor: `--filter-${id}` } as React.CSSProperties}>
        <Form action={action} scroll={false} className={styles.menuForm} aria-label={label} onChange={(event) => event.currentTarget.requestSubmit()}>
          {Object.entries(keep).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <FilterGroups groups={groups} selected={selected} counts={counts} />
          <div className={styles.menuActions}>
            <button type="submit" {...buttonProps("secondary", "sm")} hidden={hydrated}>
              Apply
            </button>
            {filtered && (
              <Link href={clearHref} {...buttonProps("tertiary", "sm")} scroll={false}>
                Clear
              </Link>
            )}
          </div>
        </Form>
      </div>
    </>
  );
}
