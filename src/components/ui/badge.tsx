import { Icon, type IconName } from "./icon";
import styles from "./badge.module.css";

export type Tone = "neutral" | "success" | "error" | "warning" | "info";

interface BadgeProps {
  children: React.ReactNode;
  tone?: Tone;
  icon?: IconName;
  spin?: boolean;
  title?: string;
}

/** A status chip: icon shape, color, and text together, never color alone. */
export function Badge({ children, tone = "neutral", icon, spin = false, title }: BadgeProps) {
  return (
    <span className={[styles.badge, tone !== "neutral" && styles[tone]].filter(Boolean).join(" ")} title={title}>
      {icon && <Icon name={icon} size={12} className={[styles.icon, spin && styles.spin].filter(Boolean).join(" ")} />}
      <span>{children}</span>
    </span>
  );
}

const STATUSES: Record<string, [Tone, IconName, string]> = {
  queued: ["neutral", "clock", "Queued"],
  pending: ["neutral", "clock", "Pending"],
  acquiring: ["info", "spinner", "Acquiring"],
  analyzing: ["info", "spinner", "Analyzing"],
  evaluating: ["info", "spinner", "Evaluating"],
  finalizing: ["info", "spinner", "Finalizing"],
  complete: ["success", "checkCircle", "Complete"],
  complete_with_issues: ["warning", "alert", "Complete with issues"],
  failed: ["error", "xCircle", "Failed"],
  canceled: ["neutral", "slash", "Canceled"],
  meets: ["success", "checkCircle", "Meets"],
  gap: ["error", "xCircle", "Gap"],
  indeterminate: ["warning", "help", "Indeterminate"],
  not_applicable: ["neutral", "minus", "Not applicable"],
  observed: ["success", "eye", "Observed"],
  inferred: ["info", "sparkle", "Inferred"],
  unknown: ["neutral", "help", "Unknown"],
  conflicting: ["warning", "alert", "Conflicting"],
  absent: ["neutral", "minus", "None detected"],
  mixed: ["info", "layers", "Mixed"],
  resolved: ["success", "checkCircle", "Resolved"],
  ambiguous: ["warning", "alert", "Ambiguous"],
  unresolved: ["neutral", "help", "Unresolved"],
  out_of_scope: ["neutral", "slash", "Out of scope"],
  enabled: ["success", "checkCircle", "Enabled"],
  disabled: ["neutral", "minus", "Disabled"],
  draft: ["neutral", "edit", "Draft"],
  published: ["success", "lock", "Published"],
};

const SPINNING = new Set(["acquiring", "analyzing", "evaluating", "finalizing"]);

export function statusLabel(state: string): string {
  return STATUSES[state]?.[2] ?? state.replaceAll("_", " ");
}

export function StatusBadge({ state, label }: { state: string; label?: string }) {
  const [tone, icon, fallback] = STATUSES[state] ?? ["neutral", "info", state.replaceAll("_", " ")];
  return (
    <Badge tone={tone} icon={icon} spin={SPINNING.has(state)}>
      <span data-state={state}>{label ?? fallback}</span>
    </Badge>
  );
}
