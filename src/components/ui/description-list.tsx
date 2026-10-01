import styles from "./description-list.module.css";

export type DescriptionItem = readonly [term: React.ReactNode, value: React.ReactNode];

/**
 * Terms and values. `rows` puts each term beside its value; `columns` puts the
 * term above the value in a responsive grid, for overviews. `surface` sets a
 * list that stands on its own on a bordered content surface, as overviews and
 * Details do; a list inside a Panel stays plain, so surfaces never nest.
 */
export function DescriptionList({ items, layout = "rows", surface = false }: { items: readonly DescriptionItem[]; layout?: "rows" | "columns"; surface?: boolean }) {
  return (
    <dl className={[layout === "columns" ? styles.columns : styles.rows, surface && styles.surface].filter(Boolean).join(" ")} data-panel={surface ? "" : undefined}>
      {items.map(([term, value], index) => (
        <div key={index} className={styles.item}>
          <dt className={styles.term}>{term}</dt>
          <dd className={styles.value}>{value ?? <span className={styles.empty}>—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
