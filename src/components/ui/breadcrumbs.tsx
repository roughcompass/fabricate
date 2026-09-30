import Link from "next/link";
import styles from "./breadcrumbs.module.css";

export interface Crumb {
  href: string;
  label: string;
}

/** The record's ancestors, each linked; the page's own title follows in the page header. */
export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
      <ol className={styles.list}>
        {items.map((item, index) => (
          <li key={index} className={styles.item}>
            <Link href={item.href} className={styles.link}>
              {item.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
