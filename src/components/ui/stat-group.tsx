import Link from "next/link";
import styles from "./stat-group.module.css";

export interface StatItem {
  label: string;
  value: React.ReactNode;
  /** A short line under the value, such as a status or a comparison. */
  hint?: React.ReactNode;
  href?: string;
}

/** Key figures in one bordered row, divided rather than boxed individually. */
export function StatGroup({ stats, label }: { stats: readonly StatItem[]; label?: string }) {
  return (
    <dl className={styles.group} aria-label={label} data-panel="">
      {stats.map((stat) => (
        <div key={stat.label} className={styles.stat}>
          <dt className={styles.label}>{stat.label}</dt>
          <dd className={styles.value}>{stat.href ? <Link href={stat.href}>{stat.value}</Link> : stat.value}</dd>
          {stat.hint && <dd className={styles.hint}>{stat.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
