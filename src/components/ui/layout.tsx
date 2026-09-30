import Link from "next/link";
import { Icon } from "./icon";
import styles from "./layout.module.css";

export const ui = styles;

type Width = "standard" | "settings" | "narrow";

/** A page body at one of the design system's content-width tiers. */
export function Page({ width = "standard", children }: { width?: Width; children: React.ReactNode }) {
  return <div className={`${styles.page} ${styles[width]}`}>{children}</div>;
}

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  back?: { href: string; label: string };
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, back, badge, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.heading}>
        {back && (
          <div className={styles.eyebrow}>
            <Link href={back.href}>
              <Icon name="arrowLeft" size={12} />
              {back.label}
            </Link>
          </div>
        )}
        <div className={styles.titleRow}>
          <h1>{title}</h1>
          {badge}
        </div>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

interface CardProps {
  title?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Lets a table or list run edge to edge inside the card. */
  flush?: boolean;
  children?: React.ReactNode;
  labelledBy?: string;
}

export function Card({ title, description, actions, flush = false, children }: CardProps) {
  return (
    <section className={styles.card} aria-label={title}>
      {(title || actions) && (
        <div className={styles.cardHeader}>
          <div>
            {title && <h2 className={styles.cardTitle}>{title}</h2>}
            {description && <p className={styles.cardDescription}>{description}</p>}
          </div>
          {actions && <div className={styles.cluster}>{actions}</div>}
        </div>
      )}
      {children !== undefined && <div className={flush ? styles.cardBodyFlush : styles.cardBody}>{children}</div>}
    </section>
  );
}

export function EmptyState({ title, children, actions }: { title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className={styles.emptyState}>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className={styles.cluster}>{actions}</div>}
    </div>
  );
}

export function Tabs({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      {children}
    </nav>
  );
}

export function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={styles.tab} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}

export function DetailsList({ items }: { items: readonly (readonly [React.ReactNode, React.ReactNode])[] }) {
  return (
    <dl className={styles.details}>
      {items.map(([term, value], index) => (
        <div key={index} className={styles.contents}>
          <dt>{term}</dt>
          <dd>{value ?? <span className={styles.muted}>—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {hint && <div className={styles.statLabel}>{hint}</div>}
    </div>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return <span className={styles.chip}>{children}</span>;
}

export function ChipList({ values }: { values: readonly string[] }) {
  if (values.length === 0) return <span className={styles.muted}>—</span>;
  return (
    <span className={styles.chipList}>
      {values.map((value) => (
        <Chip key={value}>{value}</Chip>
      ))}
    </span>
  );
}

export function Stack({ large = false, children }: { large?: boolean; children: React.ReactNode }) {
  return <div className={large ? styles.stackLarge : styles.stack}>{children}</div>;
}

export function Cluster({ children }: { children: React.ReactNode }) {
  return <div className={styles.cluster}>{children}</div>;
}
