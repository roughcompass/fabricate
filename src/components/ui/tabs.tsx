import Link from "next/link";
import styles from "./tabs.module.css";
import { formatNumber } from "@/components/ui/count";

/**
 * Links between views of one page, such as filters or sub-views; the current
 * tab is marked. `aside` holds a control that belongs to the views, such as a search.
 */
export function Tabs({ label, aside, children }: { label: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={styles.bar}>
      <nav className={styles.tabs} aria-label={label} data-scroll-x="">
        {children}
      </nav>
      {aside && <div className={styles.aside}>{aside}</div>}
    </div>
  );
}

export function TabLink({ href, active, count, children }: { href: string; active: boolean; count?: number; children: React.ReactNode }) {
  return (
    <Link href={href} className={styles.tab} aria-current={active ? "page" : undefined} scroll={false}>
      {children}
      {count !== undefined && <span className={styles.count}>{formatNumber(count)}</span>}
    </Link>
  );
}
