import { useId } from "react";
import styles from "./section.module.css";

interface SectionProps {
  title: string;
  /** One sentence, at most. */
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** 3 for sections nested under another section's heading. */
  level?: 2 | 3;
  id?: string;
  children: React.ReactNode;
}

/** A titled part of a page: a heading, an optional description, and content, with no border of its own. */
export function Section({ title, description, actions, level = 2, id, children }: SectionProps) {
  const headingId = useId();
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <section id={id} className={styles.section} aria-labelledby={headingId} data-level={level}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <Heading id={headingId} className={styles.title}>
            {title}
          </Heading>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}
