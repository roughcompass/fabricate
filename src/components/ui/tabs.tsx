import Link from "next/link";
import styles from "./tabs.module.css";
import { TabRow } from "./tab-row";
import { formatNumber } from "@/components/ui/count";

/**
 * Links between views of one page, such as filters or sub-views; the current
 * tab is marked. They stay on one row, which scrolls sideways when they don't
 * fit. `aside` holds a control that belongs to the views, such as a search.
 */
export function Tabs({ label, aside, children }: { label: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={styles.bar}>
      <TabRow className={styles.tabs} label={label}>
        {children}
      </TabRow>
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
