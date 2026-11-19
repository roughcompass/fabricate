import Link from "next/link";
import styles from "./stat-group.module.css";

export interface StatItem {
  label: string;
  value: React.ReactNode;
  /** A short line under the value, such as a status or a comparison. */
  hint?: React.ReactNode;
  /** The value is a status, such as Complete or Partial: set at the body size with its indicator, never at the figures' size. */
  status?: boolean;
  href?: string;
}

/** Key figures in one bordered row, divided rather than boxed individually; a row holds at most five (page-templates spec). */
export function StatGroup({ stats, label }: { stats: readonly StatItem[]; label?: string }) {
  return (
    <dl className={styles.group} aria-label={label} data-panel="" data-key-figures="">
      {stats.map((stat) => (
        <div key={stat.label} className={styles.stat} data-key-figure="">
          <dt className={styles.label}>{stat.label}</dt>
          <dd className={stat.status ? styles.statusValue : styles.value}>{stat.href ? <Link href={stat.href}>{stat.value}</Link> : stat.value}</dd>
          {stat.hint && <dd className={styles.hint}>{stat.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
