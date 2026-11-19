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
 * Whether a change to +target+ applies at once: a select or check box does,
 * but a field typed into doesn't. React reports each key in a text field as a
 * change, and applying one would reload the results and remount the bar,
 * taking focus from the field after its first letter.
 */
function appliesOnChange(target: EventTarget): boolean {
  return !(target instanceof HTMLInputElement && (target.type === "search" || target.type === "text"));
}

/**
 * Filters above the results they filter. With JavaScript, a select or check
 * box applies as it changes, and a search field on Enter; without it, the
 * Apply button submits them. Either way the filters live in the URL.
 */
export function FilterBar({ action, label, filtered, clearHref, keep = {}, children }: FilterBarProps) {
  const hydrated = useHydrated();
  return (
    <Form
      action={action}
      scroll={false}
      className={styles.bar}
      aria-label={label}
      onChange={(event) => {
        if (appliesOnChange(event.target)) event.currentTarget.requestSubmit();
      }}
    >
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
