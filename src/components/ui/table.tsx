import styles from "./table.module.css";

interface TableProps {
  label: string;
  head: React.ReactNode;
  children: React.ReactNode;
  /** Scrolls sideways instead of wrapping, for tables with many numeric columns. */
  scroll?: boolean;
}

/** A data table with a quiet header, collapsing into labelled rows on narrow screens. */
export function Table({ label, head, children, scroll = false }: TableProps) {
  const table = (
    <table className={styles.table} aria-label={label}>
      <thead>
        <tr>{head}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
  return scroll ? (
    <div className={styles.scroll} data-scroll-x="">
      {table}
    </div>
  ) : (
    table
  );
}

type Align = "numeric" | "actions";

export function Th({ children, align, hidden }: { children?: React.ReactNode; align?: Align; hidden?: boolean }) {
  return (
    <th scope="col" className={align ? styles[align] : undefined}>
      {hidden ? <span className="visually-hidden">{children}</span> : children}
    </th>
  );
}

export function Td({ label, align, children }: { label?: string; align?: Align; children?: React.ReactNode }) {
  return (
    <td data-label={label} className={align ? styles[align] : undefined}>
      <div className={styles.cell}>{children}</div>
    </td>
  );
}

/** A row that stands in for an empty table: an empty state spanning every column. */
export function EmptyRow({ columns, children }: { columns: number; children: React.ReactNode }) {
  return (
    <tr className={styles.emptyRow}>
      <td colSpan={columns}>{children}</td>
    </tr>
  );
}

/** The row's main text; its link is the row's navigation. */
export function Primary({ children }: { children: React.ReactNode }) {
  return <div className={styles.primary}>{children}</div>;
}

export function Secondary({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return <div className={mono ? `${styles.secondary} ${styles.mono}` : styles.secondary}>{children}</div>;
}

/** Row-level controls, aligned with the row's first line so they never make it taller. */
export function RowActions({ children }: { children: React.ReactNode }) {
  return <div className={styles.rowActions}>{children}</div>;
}
