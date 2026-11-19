import styles from "./skeleton.module.css";

type Width = "short" | "medium" | "long" | "full";

/** A placeholder block while content loads; hidden from assistive technology. Each page template's skeleton (src/components/templates/) is built from it. */
export function Skeleton({ width = "full", height = "text" }: { width?: Width; height?: "text" | "title" | "control" | "row" | "block" }) {
  return <span className={styles.skeleton} data-width={width} data-height={height} aria-hidden="true" />;
}

/**
 * The Repositories table as it lays out, for the Index skeleton of the
 * Repositories list: the head and rows in its five columns, with the name
 * over its clone URL and the profile's version over its time. On a narrow
 * screen each row becomes a block of labelled fields, as the table's do.
 */
export function RepositoriesTableSkeleton() {
  // Each column: its value's lines, and whether it aligns to the end.
  const columns: { lines: Width[]; numeric?: boolean }[] = [{ lines: ["medium", "long"] }, { lines: ["long"] }, { lines: ["medium", "long"] }, { lines: ["long"], numeric: true }];
  return (
    <div className={styles.panel}>
        <div className={`${styles.tableRow} ${styles.tableHead}`}>
          {columns.map(({ numeric }, index) => (
            <span key={index} className={styles.cell} data-numeric={numeric || undefined}>
              <span className={`${styles.skeleton} ${styles.headLabel}`} aria-hidden="true" />
            </span>
          ))}
          <span className={styles.cell} />
        </div>
        {Array.from({ length: 6 }, (_, row) => (
          <div key={row} className={styles.tableRow}>
            {columns.map(({ lines, numeric }, index) => (
              <span key={index} className={styles.cell} data-numeric={numeric || undefined}>
                <span className={`${styles.skeleton} ${styles.cellLabel}`} aria-hidden="true" />
                <span className={styles.cellValue}>
                  {lines.map((width, line) => (
                    <Skeleton key={line} width={width} />
                  ))}
                </span>
              </span>
            ))}
            <span className={styles.cell}>
              <span className={`${styles.skeleton} ${styles.menu}`} aria-hidden="true" />
            </span>
          </div>
        ))}
    </div>
  );
}

