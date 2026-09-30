import { useId } from "react";
import styles from "./tooltip.module.css";

/**
 * A short explanation shown on hover and on keyboard focus. Wrap
 * non-interactive content with `focusable` so keyboard users can reach it.
 */
export function Tooltip({ content, children, focusable = false }: { content: React.ReactNode; children: React.ReactNode; focusable?: boolean }) {
  const id = useId();
  return (
    <span className={styles.wrap} tabIndex={focusable ? 0 : undefined} aria-describedby={id}>
      {children}
      <span role="tooltip" id={id} className={styles.bubble}>
        {content}
      </span>
    </span>
  );
}
