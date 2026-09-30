import styles from "./table.module.css";

export const tableStyles = styles;

/** A data table that collapses into labelled rows on narrow screens. */
export function Table({ label, head, children }: { label: string; head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={styles.wrap}>
      <table className={`${styles.table} ${styles.responsive}`} aria-label={label}>
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

type Align = "numeric" | "actions";

export function Th({ children, align, hidden }: { children?: React.ReactNode; align?: Align; hidden?: boolean }) {
  return (
    <th scope="col" className={align ? styles[align] : undefined}>
      {hidden ? <span className={styles.visuallyHidden}>{children}</span> : children}
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

export function Primary({ children }: { children: React.ReactNode }) {
  return <div className={styles.primary}>{children}</div>;
}

export function Secondary({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return <div className={mono ? `${styles.secondary} ${styles.mono}` : styles.secondary}>{children}</div>;
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <span className={styles.mono}>{children}</span>;
}
