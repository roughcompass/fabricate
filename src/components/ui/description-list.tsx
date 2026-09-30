import styles from "./description-list.module.css";

export type DescriptionItem = readonly [term: React.ReactNode, value: React.ReactNode];

/**
 * Terms and values. `rows` puts each term beside its value; `columns` puts the
 * term above the value in a responsive grid, for overviews.
 */
export function DescriptionList({ items, layout = "rows" }: { items: readonly DescriptionItem[]; layout?: "rows" | "columns" }) {
  return (
    <dl className={layout === "columns" ? styles.columns : styles.rows}>
      {items.map(([term, value], index) => (
        <div key={index} className={styles.item}>
          <dt className={styles.term}>{term}</dt>
          <dd className={styles.value}>{value ?? <span className={styles.empty}>—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
