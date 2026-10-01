import styles from "./status.module.css";

/**
 * The single registry for how states, outcomes, severities, and other
 * enumerated values are shown: every value has one label and one tone, and
 * operators never see a raw identifier.
 */

export type Tone = "neutral" | "success" | "warning" | "error" | "progress";

const STATES: Record<string, [label: string, tone: Tone]> = {
  // Assessments, targets, Evaluations, and pinned Releases.
  queued: ["Queued", "neutral"],
  pending: ["Pending", "neutral"],
  acquiring: ["Acquiring", "progress"],
  analyzing: ["Analyzing", "progress"],
  evaluating: ["Evaluating", "progress"],
  finalizing: ["Finalizing", "progress"],
  canceling: ["Canceling", "progress"],
  complete: ["Complete", "success"],
  complete_with_issues: ["Complete with issues", "warning"],
  failed: ["Failed", "error"],
  canceled: ["Canceled", "neutral"],
  // Finding outcomes.
  meets: ["Meets", "success"],
  gap: ["Gap", "error"],
  indeterminate: ["Indeterminate", "warning"],
  not_applicable: ["Not applicable", "neutral"],
  // Fact and category states.
  observed: ["Observed", "success"],
  inferred: ["Inferred", "progress"],
  mixed: ["Mixed", "progress"],
  conflicting: ["Conflicting", "warning"],
  unknown: ["Unknown", "neutral"],
  absent: ["None detected", "neutral"],
  // Relationship resolution.
  resolved: ["Resolved", "success"],
  ambiguous: ["Ambiguous", "warning"],
  unresolved: ["Unresolved", "neutral"],
  out_of_scope: ["Out of scope", "neutral"],
  // Sources and Standards.
  enabled: ["Enabled", "success"],
  disabled: ["Disabled", "neutral"],
  draft: ["Draft", "neutral"],
  draft_ready: ["Ready to publish", "success"],
  draft_problems: ["Has problems", "warning"],
  no_draft: ["No draft", "neutral"],
  unsaved: ["Unsaved changes", "warning"],
  published: ["Published", "success"],
  // Directory import candidates.
  importable: ["Ready to add", "progress"],
  registered: ["Already registered", "neutral"],
  rejected: ["Rejected", "error"],
  // Service Dependency boundaries.
  characterized: ["Boundary characterized", "success"],
  incomplete: ["Boundary incomplete", "warning"],
  // How each step of a Finding's trace was read.
  holds: ["Holds", "success"],
  does_not_hold: ["Does not hold", "error"],
  // Evaluation conclusions.
  gaps: ["Gaps found", "error"],
  undetermined: ["Undetermined", "warning"],
  conforms: ["Conforms", "success"],
  // Template demo applications and their simulated builds.
  building: ["Building", "progress"],
  ready: ["Ready", "success"],
};

/** A readable label for a value without a mapping: underscores become spaces, first letter capitalized. */
export function humanize(value: string): string {
  const words = value.replaceAll("_", " ").replaceAll("-", " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "None";
}

/** Whether a value has an explicit entry in the registry. */
export function hasStatus(state: string): boolean {
  return Object.hasOwn(STATES, state);
}

export function statusOf(state: string): { label: string; tone: Tone } {
  const [label, tone] = STATES[state] ?? [humanize(state), "neutral"];
  return { label, tone };
}

export function statusLabel(state: string): string {
  return statusOf(state).label;
}

/** A colored indicator beside a text label; never color alone. */
export function Status({ state, label, size = "md" }: { state: string; label?: string; size?: "sm" | "md" }) {
  const status = statusOf(state);
  return (
    <span className={styles.status} data-tone={status.tone} data-size={size}>
      <span className={styles.dot} aria-hidden="true" />
      <span data-state={state}>{label ?? status.label}</span>
    </span>
  );
}

const SEVERITIES: Record<string, [label: string, tone: Tone]> = {
  critical: ["Critical", "error"],
  high: ["High", "error"],
  medium: ["Medium", "warning"],
  low: ["Low", "neutral"],
  info: ["Info", "neutral"],
};

export function severityLabel(severity: string): string {
  return SEVERITIES[severity]?.[0] ?? humanize(severity);
}

/** A severity with its indicator; the same label wherever a severity appears. */
export function Severity({ value }: { value: string }) {
  const [label, tone] = SEVERITIES[value] ?? [humanize(value), "neutral"];
  return (
    <span className={styles.severity} data-tone={tone}>
      <span className={styles.bars} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Severity options for a select, most severe first. */
export function severityOptions(severities: readonly string[]): { value: string; label: string }[] {
  const order = Object.keys(SEVERITIES);
  return [...severities].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((value) => ({ value, label: severityLabel(value) }));
}

const DIAGNOSTIC_REASONS: Record<string, string> = {
  parse_failed: "Could not be parsed",
  syntax_error: "Syntax error",
  syntax_depth_limit: "Nested too deeply to read",
  syntax_node_limit: "Too large to read",
  total_budget_exhausted: "Analysis budget used up",
  too_large: "Over the size limit",
  unsupported: "Unsupported construct",
  unsupported_version: "Unsupported version",
  unsupported_assertion: "Unsupported assertion",
  unreadable: "Could not be read",
  symlink: "Symbolic link, not followed",
  sensitive: "Sensitive file, not read",
  protected_path: "Protected path, not read",
  path_rejected: "Path rejected",
  not_source: "Not a source file",
  missing: "Missing",
  computed: "Computed at run time",
};

/** Why an input was skipped or noted, in words. */
export function diagnosticReason(reason: string): string {
  return DIAGNOSTIC_REASONS[reason] ?? humanize(reason);
}

const EDGE_BASES: Record<string, string> = {
  observed: "Observed in source",
  inferred: "Inferred from naming",
};

/** How a relationship was established, in words. */
export function edgeBasis(basis: string): string {
  return EDGE_BASES[basis] ?? humanize(basis);
}

/** A boolean choice for a select or a summary. */
export function booleanLabel(value: boolean): string {
  return value ? "Yes" : "No";
}
