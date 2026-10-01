"use client";

import Form from "next/form";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { buttonProps } from "./button-content";
import { formStyles } from "./form";
import { Icon } from "./icon";
import styles from "./filter-rail.module.css";

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
