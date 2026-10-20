import styles from "./editor.module.css";

interface Pane {
  title: string;
  /** A short note beside the title, such as "Editing Banner Zone". */
  note?: React.ReactNode;
  /** Controls at the header's end, such as the preview's device toggle. */
  aside?: React.ReactNode;
  flush?: boolean;
  children: React.ReactNode;
}

export function EditorPane({ title, note, aside, flush, children, label }: Pane & { label: string }) {
  return (
    <section className={styles.pane} aria-label={label}>
      <div className={styles.paneHeader}>
        <h2 className={styles.paneTitle}>{title}</h2>
        {note && <span className={styles.paneNote}>{note}</span>}
        {aside && <span className={styles.paneAside}>{aside}</span>}
      </div>
      <div className={styles.paneBody} data-flush={flush ? "" : undefined}>
        {children}
      </div>
    </section>
  );
}

/**
 * The experience editor's panes (experience-editor spec, "Views show a list,
 * a live preview, and options"): a list at the left, the preview or a
 * section in the middle, and the Options panel at the right; or, for Portal
 * Configuration, just the list and the section. They stack on a narrow
 * content column.
 */
export function EditorPanes({ list, main, options }: { list: Pane; main: Pane; options?: Pane }) {
  return (
    <div className={styles.panes} data-layout={options ? "three" : "two"}>
      <EditorPane {...list} label={list.title} />
      <EditorPane {...main} label={main.title} />
      {options && <EditorPane {...options} label={options.title} />}
    </div>
  );
}
