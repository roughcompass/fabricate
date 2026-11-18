import Link from "next/link";
import styles from "./pagination.module.css";

/**
 * Links between the pages of a long list. The page lives in the address, so
 * every page can be shared and works without JavaScript. Shows the first and
 * last pages, the current one and its neighbours, and a gap between them.
 * A list among others on a long page passes +scrollToTop+ with addresses that
 * end in its anchor, so a new page opens at the top of that list rather than
 * where the reader left the old one.
 */
export function Pagination({ label, page, pages, href, scrollToTop = false }: { label: string; page: number; pages: number; href: (page: number) => string; scrollToTop?: boolean }) {
  if (pages <= 1) return null;
  const shown = [...new Set([1, page - 1, page, page + 1, pages])].filter((number) => number >= 1 && number <= pages).sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  for (const [index, number] of shown.entries()) {
    if (index > 0 && number - shown[index - 1]! > 1) items.push("gap");
    items.push(number);
  }
  return (
    <nav className={styles.pagination} aria-label={label}>
      <p className={styles.position}>{`Page ${page.toLocaleString("en-US")} of ${pages.toLocaleString("en-US")}`}</p>
      <ul className={styles.pages}>
        <li>
          {page > 1 ? (
            <Link href={href(page - 1)} className={styles.step} rel="prev" scroll={scrollToTop}>
              Previous
            </Link>
          ) : (
            <span className={styles.step} aria-disabled="true">
              Previous
            </span>
          )}
        </li>
        {items.map((item, index) =>
          item === "gap" ? (
            <li key={`gap-${index}`} className={styles.gap} aria-hidden="true">
              …
            </li>
          ) : (
            <li key={item}>
              <Link href={href(item)} className={styles.page} aria-current={item === page ? "page" : undefined} aria-label={`Page ${item}`} scroll={scrollToTop}>
                {item.toLocaleString("en-US")}
              </Link>
            </li>
          ),
        )}
        <li>
          {page < pages ? (
            <Link href={href(page + 1)} className={styles.step} rel="next" scroll={scrollToTop}>
              Next
            </Link>
          ) : (
            <span className={styles.step} aria-disabled="true">
              Next
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
