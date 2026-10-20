import styles from "./card-grid.module.css";

/**
 * A grid of cards (runtime-configuration spec, "Card grids show at most three
 * cards per row"): at most three per row on wide content columns, two on
 * medium ones, one on a phone, with the cards in a row at equal heights. The
 * list is named by +label+.
 */
export function CardGrid({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <ul className={styles.grid} aria-label={label} data-card-grid="">
      {children}
    </ul>
  );
}
