import { Status } from "@/components/ui/status";
import type { NoValue } from "@/lib/profiles/states";
import styles from "./results.module.css";

/**
 * Where a value would be, when there is none: its state's indicator and label,
 * then why. Never a dash or "No data", which can't tell unknown from none detected.
 */
export function NoValuePlaceholder({ value }: { value: NoValue }) {
  return (
    <span className={styles.noValue}>
      <Status state={value.state} size="sm" />
      <span className={styles.muted}>{value.reason}</span>
    </span>
  );
}
