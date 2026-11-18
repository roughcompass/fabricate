"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icon";
import { useHydrated } from "./use-hydrated";
import styles from "./copy-button.module.css";

/**
 * Copies a full value to the clipboard and confirms it. Hidden until
 * JavaScript runs; the value it copies stays selectable either way.
 */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const hydrated = useHydrated();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!hydrated) return null;
  return (
    <>
      <button
        type="button"
        className={styles.copy}
        data-copied={copied || undefined}
        aria-label={copied ? "Copied" : label}
        title={copied ? "Copied" : label}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={14} />
      </button>
      <span role="status" className="visually-hidden">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}
