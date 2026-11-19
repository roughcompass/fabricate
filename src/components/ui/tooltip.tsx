import { useId } from "react";
import styles from "./tooltip.module.css";

/**
 * A short explanation shown on hover and on keyboard focus. Wrap
 * non-interactive content with `focusable` so keyboard users can reach it.
 * It opens above, centered, unless `placement` and `align` say otherwise, as
 * at the top or edges of a scrolling panel that would clip it.
 */
export function Tooltip({
  content,
  children,
  focusable = false,
  visualOnly = false,
  placement = "above",
  align = "center",
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  focusable?: boolean;
  /** For a value whose content already says what the bubble does, such as a relative time with its full date for assistive technology: the bubble is for pointers only. */
  visualOnly?: boolean;
  placement?: "above" | "below";
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const id = useId();
  return (
    <span className={[styles.wrap, className].filter(Boolean).join(" ")} tabIndex={focusable ? 0 : undefined} aria-describedby={visualOnly ? undefined : id}>
      {children}
      <span role={visualOnly ? undefined : "tooltip"} id={id} className={styles.bubble} data-placement={placement} data-align={align} aria-hidden={visualOnly || undefined}>
        {content}
      </span>
    </span>
  );
}
