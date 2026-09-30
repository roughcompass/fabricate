import { useId } from "react";
import styles from "./panel.module.css";

interface PanelProps {
  title?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  /** Lets a table or list run edge to edge. */
  flush?: boolean;
  /** A danger zone: destructive actions for a record. */
  tone?: "default" | "danger";
  level?: 2 | 3;
  children?: React.ReactNode;
}

/**
 * A bordered container for a table, form, list, or code. Panels never nest:
 * inside a panel, group content with spacing and dividers instead.
 */
export function Panel({ title, description, actions, footer, flush = false, tone = "default", level = 2, children }: PanelProps) {
  const headingId = useId();
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <section className={styles.panel} data-tone={tone} data-panel="" aria-labelledby={title ? headingId : undefined}>
      {(title || actions) && (
        <div className={styles.header}>
          <div className={styles.heading}>
            {title && (
              <Heading id={headingId} className={styles.title}>
                {title}
              </Heading>
            )}
            {description && <p className={styles.description}>{description}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
      {children !== undefined && <div className={flush ? styles.flush : styles.body}>{children}</div>}
      {footer && <div className={styles.footer}>{footer}</div>}
    </section>
  );
}
