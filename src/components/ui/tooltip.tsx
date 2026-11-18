import { useId } from "react";
import styles from "./tooltip.module.css";

/**
 * A short explanation shown on hover and on keyboard focus. Wrap
 * non-interactive content with `focusable` so keyboard users can reach it.
 * It opens above, centered, unless `placement` and `align` say otherwise, as
 * at the top or edges of a scrolling panel that would clip it.
 */
export function Tooltip({ content, children, focusable = false, placement = "above", align = "center", className }: { content: React.ReactNode; children: React.ReactNode; focusable?: boolean; placement?: "above" | "below"; align?: "start" | "center" | "end"; className?: string }) {
  const id = useId();
  return (
    <span className={[styles.wrap, className].filter(Boolean).join(" ")} tabIndex={focusable ? 0 : undefined} aria-describedby={id}>
      {children}
      <span role="tooltip" id={id} className={styles.bubble} data-placement={placement} data-align={align}>
        {content}
      </span>
    </span>
  );
}
