import { Status, statusLabel } from "@/components/ui/status";
import type { NoValue } from "@/lib/profiles/states";
import styles from "./results.module.css";

/**
 * Where a value would be, when there is none: its state's indicator and label,
 * then why. Never a dash or "No data", which can't tell unknown from none detected.
 */
export function NoValuePlaceholder({ value }: { value: NoValue }) {
  // One Status holds the label and the reason, so a reason that wraps lines up with the label, not under the indicator.
  return (
    <Status state={value.state} size="sm">
      <span>{statusLabel(value.state)}</span>
      <span className={styles.muted}>{value.reason}</span>
    </Status>
  );
}
