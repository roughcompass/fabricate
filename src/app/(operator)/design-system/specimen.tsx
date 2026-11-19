import styles from "./design-system.module.css";

/**
 * One component's specimens, rendered in the light and dark themes side by
 * side, or one above the other with `stacked` for a component that needs the
 * full width. `render` receives a per-theme prefix for ids, so both copies stay valid.
 */
export function Specimen({ id, title, description, render, single = false, stacked = false }: { id: string; title: string; description?: string; render: (theme: "light" | "dark") => React.ReactNode; single?: boolean; stacked?: boolean }) {
  return (
    <section id={id} className={styles.specimen} aria-labelledby={`${id}-title`}>
      <div className={styles.specimenHeader}>
        <h2 id={`${id}-title`}>{title}</h2>
        {description && <p className={styles.specimenDescription}>{description}</p>}
      </div>
      <div className={single || stacked ? styles.single : styles.pair}>
        {(single ? (["light"] as const) : (["light", "dark"] as const)).map((theme) => (
          <div key={theme} data-theme={theme} data-specimen="" className={styles.frame} role="region" aria-label={`${title}, ${theme}`}>
            {render(theme)}
          </div>
        ))}
      </div>
    </section>
  );
}

/** A labelled row of specimens inside a frame. */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <p className={styles.rowLabel}>{label}</p>
      <div className={styles.rowItems}>{children}</div>
    </div>
  );
}
