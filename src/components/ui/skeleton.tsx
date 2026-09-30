import styles from "./skeleton.module.css";

type Width = "short" | "medium" | "long" | "full";

/** A placeholder block while content loads; hidden from assistive technology. */
export function Skeleton({ width = "full", height = "text" }: { width?: Width; height?: "text" | "title" | "control" | "row" | "block" }) {
  return <span className={styles.skeleton} data-width={width} data-height={height} aria-hidden="true" />;
}

/** The page header and a table: for list pages. */
export function ListSkeleton() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading">
      <div className={styles.header}>
        <Skeleton width="short" height="title" />
        <Skeleton width="medium" />
      </div>
      <div className={styles.panel}>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className={styles.row}>
            <Skeleton width="medium" />
            <Skeleton width="long" />
            <Skeleton width="short" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Breadcrumbs, a header, an overview row, and a table: for detail pages. */
export function DetailSkeleton() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading">
      <div className={styles.header}>
        <Skeleton width="medium" />
        <Skeleton width="medium" height="title" />
        <Skeleton width="long" />
      </div>
      <div className={styles.stats}>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className={styles.stat}>
            <Skeleton width="short" />
            <Skeleton width="medium" height="title" />
          </div>
        ))}
      </div>
      <div className={styles.panel}>
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className={styles.row}>
            <Skeleton width="medium" />
            <Skeleton width="long" />
            <Skeleton width="short" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A header and a column of fields: for create and edit forms. */
export function FormSkeleton() {
  return (
    <div className={styles.form} aria-busy="true" aria-label="Loading">
      <div className={styles.header}>
        <Skeleton width="medium" />
        <Skeleton width="medium" height="title" />
      </div>
      <div className={styles.panelPadded}>
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className={styles.field}>
            <Skeleton width="short" />
            <Skeleton height="control" />
          </div>
        ))}
      </div>
    </div>
  );
}
