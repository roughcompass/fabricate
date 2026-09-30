import { Icon } from "./icon";
import styles from "./disclosure.module.css";

interface DisclosureProps {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** `panel` draws a bordered container; `plain` is a quiet toggle for secondary details. */
  variant?: "panel" | "plain";
  id?: string;
  /** Content shown at the end of the summary row, such as counts or a menu. */
  aside?: React.ReactNode;
}

/** Content that expands in place; a native <details>, so it works without JavaScript. */
export function Disclosure({ summary, children, defaultOpen = false, variant = "panel", id, aside }: DisclosureProps) {
  return (
    <details id={id} className={variant === "panel" ? styles.panel : styles.plain} open={defaultOpen} data-panel={variant === "panel" ? "" : undefined}>
      <summary className={styles.summary}>
        <Icon name="chevronRight" size={14} className={styles.chevron} />
        <span className={styles.label}>{summary}</span>
        {aside && <span className={styles.aside}>{aside}</span>}
      </summary>
      <div className={styles.content}>{children}</div>
    </details>
  );
}
