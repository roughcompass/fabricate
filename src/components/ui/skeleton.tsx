import { ShellHeader } from "@/components/shell/shell-header";
import { Page } from "./page";
import styles from "./skeleton.module.css";

type Width = "short" | "medium" | "long" | "full";

/** A placeholder block while content loads; hidden from assistive technology. */
export function Skeleton({ width = "full", height = "text" }: { width?: Width; height?: "text" | "title" | "control" | "row" | "block" }) {
  return <span className={styles.skeleton} data-width={width} data-height={height} aria-hidden="true" />;
}

/** The shell header with a title placeholder, the page header, and a table: for list pages. */
export function ListSkeleton() {
  return (
    <Page busy>
      <ShellHeader />
      <div className={styles.header}>
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
    </Page>
  );
}

/**
 * The Repositories list as it lays out: the description beside its actions,
 * the count beside the Ownership filter and search, and the table's head and
 * rows in its six columns, with the name over its clone URL and the profile's
 * version over its time. On a narrow screen it follows the page as the page
 * collapses: the secondary actions into a menu, the filters below the count,
 * and each row into a block of labelled fields.
 */
export function RepositoriesSkeleton() {
  // Each column: its value's lines, and whether it aligns to the end.
  const columns: { lines: Width[]; numeric?: boolean }[] = [{ lines: ["medium", "long"] }, { lines: ["medium", "medium"] }, { lines: ["long"] }, { lines: ["medium", "long"] }, { lines: ["long"], numeric: true }];
  return (
    <Page busy>
      <ShellHeader />
      <div className={styles.headerRow}>
        <div className={styles.description}>
          <Skeleton />
          <Skeleton width="long" />
        </div>
        {/* Add in bulk, Claim a Repository, and New Repository; on a narrow screen, the menu and New Repository. */}
        <div className={styles.actions}>
          <span className={`${styles.skeleton} ${styles.action}`} data-action="secondary" aria-hidden="true" />
          <span className={`${styles.skeleton} ${styles.action}`} data-action="secondary" aria-hidden="true" />
          <span className={`${styles.skeleton} ${styles.action}`} data-action="overflow" aria-hidden="true" />
          <span className={`${styles.skeleton} ${styles.action}`} data-action="primary" aria-hidden="true" />
        </div>
      </div>
      <div className={styles.toolbar}>
        <span className={styles.count}>
          <Skeleton width="long" />
        </span>
        <div className={styles.filters}>
          <span className={styles.filter}>
            <span className={`${styles.skeleton} ${styles.filterLabel}`} aria-hidden="true" />
            <span className={`${styles.skeleton} ${styles.filterControl}`} aria-hidden="true" />
          </span>
          <span className={`${styles.skeleton} ${styles.filterControl}`} aria-hidden="true" />
        </div>
      </div>
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
    </Page>
  );
}

/** The shell header, breadcrumbs and a meta line, an overview row, and a table: for detail pages. */
export function DetailSkeleton() {
  return (
    <Page busy>
      <ShellHeader />
      <div className={styles.header}>
        <Skeleton width="medium" />
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
    </Page>
  );
}

/** The shell header, the page description, three rows of figures, and the Needs attention table: for Home. */
export function HomeSkeleton() {
  return (
    <Page busy>
      <ShellHeader />
      <div className={styles.header}>
        <Skeleton width="long" />
      </div>
      {[3, 5, 2].map((figures, group) => (
        <div key={group} className={styles.stats}>
          {Array.from({ length: figures }, (_, index) => (
            <div key={index} className={styles.stat}>
              <Skeleton width="short" />
              <Skeleton width="medium" height="title" />
            </div>
          ))}
        </div>
      ))}
      <div className={styles.panel}>
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className={styles.row}>
            <Skeleton width="long" />
            <Skeleton width="medium" />
            <Skeleton width="short" />
          </div>
        ))}
      </div>
    </Page>
  );
}

/** The shell header, breadcrumbs, and a column of fields: for create and edit forms. */
export function FormSkeleton() {
  return (
    <Page width="form" busy>
      <ShellHeader />
      <div className={styles.header}>
        <Skeleton width="medium" />
      </div>
      <div className={styles.panelPadded}>
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className={styles.field}>
            <Skeleton width="short" />
            <Skeleton height="control" />
          </div>
        ))}
      </div>
    </Page>
  );
}

/**
 * A focused page's skeleton, for preview mode: the focused shell header with
 * a placeholder for its back button, which hides the sidebar as soon as the
 * navigation starts, then the tab row and, close below it, the gray
 * container.
 */
export function FocusedSkeleton() {
  return (
    <Page busy>
      <ShellHeader back="placeholder" />
      <div className={styles.workspace}>
        <div className={styles.tabRow}>
          <Skeleton width="short" height="control" />
        </div>
        <div className={styles.container}>
          <Skeleton height="block" />
        </div>
      </div>
    </Page>
  );
}
