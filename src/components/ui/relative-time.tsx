import { formatAbsolute, formatRelative } from "./time";
import { Tooltip } from "./tooltip";
import styles from "./relative-time.module.css";

/**
 * A time as operators think of it ("2 hours ago", or a date when older), with
 * the full UTC time on hover, on focus, and in machine-readable markup.
 * Rendered on the server at request time.
 */
export function RelativeTime({ value }: { value: Date | null | undefined }) {
  if (!value) return <span className={styles.empty}>—</span>;
  const absolute = formatAbsolute(value);
  return (
    <Tooltip content={absolute} focusable>
      <time dateTime={value.toISOString()} className={styles.time}>
        {formatRelative(value)}
      </time>
    </Tooltip>
  );
}
