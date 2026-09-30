import styles from "./progress-bar.module.css";

/** Work done out of the total, as a bar with its count in words. */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.round((Math.min(value, max) / max) * 100) : 0;
  return (
    <div className={styles.progress}>
      <div className={styles.text}>
        <span>{label}</span>
        <span className={styles.percent}>{percent}%</span>
      </div>
      <div className={styles.track} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className={styles.fill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
