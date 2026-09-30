"use client";

import Form from "next/form";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { buttonClass } from "./button-content";
import styles from "./filter-bar.module.css";

const subscribeNever = () => () => {};

interface FilterBarProps {
  /** The page the filters apply to; the chosen values become its query. */
  action: string;
  label: string;
  /** Whether any filter is active, which shows Clear filters. */
  filtered: boolean;
  clearHref: string;
  /** Query values to keep, such as the selected tab. */
  keep?: Record<string, string>;
  /** Compact `sm` selects. */
  children: React.ReactNode;
}

/**
 * Filters above the results they filter. With JavaScript, a change applies
 * immediately; without it, the Apply button submits them. Either way the
 * filters live in the URL.
 */
export function FilterBar({ action, label, filtered, clearHref, keep = {}, children }: FilterBarProps) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  return (
    <Form action={action} scroll={false} className={styles.bar} aria-label={label} onChange={(event) => event.currentTarget.requestSubmit()}>
      {Object.entries(keep).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className={styles.filters}>{children}</div>
      <div className={styles.actions}>
        <button type="submit" className={buttonClass("secondary", "sm")} hidden={hydrated}>
          Apply
        </button>
        {filtered && (
          <Link href={clearHref} className={buttonClass("tertiary", "sm")} scroll={false}>
            Clear filters
          </Link>
        )}
      </div>
    </Form>
  );
}
