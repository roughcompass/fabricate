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
 * navigation starts, then the command row, the tab row, and the gray
 * container.
 */
export function FocusedSkeleton() {
  return (
    <Page busy>
      <ShellHeader back="placeholder" />
      <div className={styles.commandRow}>
        <Skeleton width="long" height="control" />
      </div>
      <div className={styles.tabRow}>
        <Skeleton width="short" height="control" />
      </div>
      <div className={styles.container}>
        <Skeleton height="block" />
      </div>
    </Page>
  );
}
