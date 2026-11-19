"use client";

import Form from "next/form";
import Link from "next/link";

import { buttonProps } from "./button-content";
import { useHydrated } from "./use-hydrated";
import styles from "./filter-bar.module.css";
import { HiddenFields } from "./form";

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
  const hydrated = useHydrated();
  return (
    <Form action={action} scroll={false} className={styles.bar} aria-label={label} onChange={(event) => event.currentTarget.requestSubmit()}>
      <HiddenFields values={keep} />
      <div className={styles.filters}>{children}</div>
      <div className={styles.actions}>
        <button type="submit" {...buttonProps("secondary", "sm")} hidden={hydrated}>
          Apply
        </button>
        {filtered && (
          <Link href={clearHref} {...buttonProps("tertiary", "sm")} scroll={false}>
            Clear filters
          </Link>
        )}
      </div>
    </Form>
  );
}
