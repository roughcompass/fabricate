import { Children, isValidElement } from "react";
import { Indicator as Mark, type IndicatorShape, type Tone, toneClass } from "./indicator";
import styles from "./status.module.css";

/**
 * The single registry for how states, outcomes, severities, and other
 * enumerated values are shown: every value has one label, one tone, and one
 * indicator, and operators never see a raw identifier.
 */

export type { Tone } from "./indicator";

/** The indicator's shape. The states that carry no value each have their own, so they differ without their labels. */
type Indicator = Exclude<IndicatorShape, "blank">;

const STATES: Record<string, [label: string, tone: Tone, indicator?: Indicator]> = {
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
  inferred: ["Inferred", "info"],
  mixed: ["Mixed", "info"],
  conflicting: ["Conflicting", "warning"],
  unknown: ["Unknown", "neutral", "ring"],
  absent: ["None detected", "neutral"],
  // A category that the Profile's detector release didn't define.
  not_covered: ["Not covered", "neutral", "dash"],
  // A category with facts whose search couldn't read every relevant input, so it may hold more.
  partial: ["Partial", "neutral", "ring"],
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
  importable: ["Ready to add", "info"],
  registered: ["Already registered", "neutral"],
  rejected: ["Rejected", "error"],
  // Service Dependency boundaries.
  characterized: ["Boundary characterized", "success"],
  // A part of a page that lists what to look at, such as a Profile's Needs attention and Skipped inputs.
  to_review: ["To review", "warning"],
  clear: ["Nothing to review", "success"],
  incomplete: ["Boundary incomplete", "warning"],
  // How each step of a Finding's trace was read.
  holds: ["Holds", "success"],
  does_not_hold: ["Does not hold", "error"],
  // Evaluation conclusions.
  gaps: ["Gaps found", "error"],
  undetermined: ["Undetermined", "warning"],
  conforms: ["Conforms", "success"],
  not_evaluated: ["Not evaluated", "neutral", "dash"],
  // Checks and their outcomes.
  active: ["Active", "success"],
  retired: ["Retired", "neutral"],
  submitted: ["Submitted", "success"],
  approved: ["Approved", "success"],
  withdrawn: ["Withdrawn", "neutral"],
  matching: ["Matching", "success"],
  missing: ["Missing", "error"],
  stale: ["Stale", "warning"],
  pass: ["Passes", "success"],
  fail: ["Fails", "error"],
  blocking: ["Blocking", "error"],
  warning: ["Warning", "warning"],
  // Repository previews: a commit being prepared or refused, and a preview's latest build attempt (Queued and Failed above).
  profiling: ["Profiling", "progress"],
  previewable: ["Previewable", "success"],
  not_previewable: ["Not previewable", "neutral"],
  building: ["Building", "progress"],
  ready: ["Ready", "success"],
  // DE Console reads, and why an entry is in conflict.
  succeeded: ["Succeeded", "success"],
  duplicate_in_export: ["Listed twice in the export", "warning"],
  several_applications: ["Matches several applications", "warning"],
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

export function statusOf(state: string): { label: string; tone: Tone; indicator: Indicator } {
  const [label, tone, indicator = "dot"] = STATES[state] ?? [humanize(state), "neutral"];
  return { label, tone, indicator };
}

export function statusLabel(state: string): string {
  return statusOf(state).label;
}

/** A colored indicator beside a text label; never color alone. */
/**
 * A state's indicator and its text, one gap apart at every size. The text is
 * the state's label, +label+ in its place, or +children+: any content that
 * the indicator marks, such as a value or a link, which may wrap with the
 * indicator kept level with its first line. Pages put text beside an
 * indicator only through this, never by placing a bare indicator next to
 * their own text, so the gap is the same everywhere. With +children+, saying
 * the state to assistive technology is the caller's choice.
 */
export function Status({ state, label, size = "md", children }: { state: string; label?: string; size?: "sm" | "md"; children?: React.ReactNode }) {
  const status = statusOf(state);
  return (
    <span className={styles.status} data-size={size} data-content={children === undefined ? undefined : ""}>
      <Mark tone={status.tone} shape={status.indicator} />
      <span data-state={state}>{children === undefined ? (label ?? status.label) : joined(children)}</span>
    </span>
  );
}

const hidden = (part: React.ReactNode) => isValidElement<{ className?: string }>(part) && part.props.className === "visually-hidden";

/**
 * A Status's content parts as text: each pair is separated by a real space
 * in a box one gap wide, so the parts look one gap apart, wrap like words,
 * and read and copy as "Unknown Composition Searched 3 inputs", never
 * "UnknownCompositionSearched 3 inputs". Text only assistive technology
 * hears follows directly, with its own punctuation.
 */
function joined(children: React.ReactNode): React.ReactNode[] {
  return Children.toArray(children).flatMap((part, index) => {
    if (index === 0) return [part];
    // Hidden text, such as ", Observed", follows directly; it carries its own punctuation.
    return hidden(part) ? [part] : [<span key={`space-${index}`} className={styles.space}>{" "}</span>, part];
  });
}

/**
 * Items of a row laid out apart by its own gap, such as an overview's values,
 * with a real space between each pair that only copied and spoken text
 * sees, so they never run together there.
 */
export function spaced(children: React.ReactNode): React.ReactNode[] {
  return Children.toArray(children).flatMap((part, index) => (index === 0 ? [part] : [<span key={`space-${index}`} className="visually-hidden">{" "}</span>, part]));
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
    <span className={`${styles.severity} ${toneClass}`} data-tone={tone}>
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

const DEPENDENCY_KINDS: Record<string, string> = {
  dependencies: "Production",
  devDependencies: "Development",
  peerDependencies: "Peer",
  optionalDependencies: "Optional",
};

/** The kind of a direct dependency, by the manifest field that declares it. */
export function dependencyKind(field: string): string {
  return DEPENDENCY_KINDS[field] ?? humanize(field);
}

const CHECK_KINDS: Record<string, string> = {
  e2e: "End-to-end",
  test: "Test",
  lint: "Lint",
  typecheck: "Typecheck",
  build: "Build",
  format: "Format",
  audit: "Audit",
};

/** What a declared verification command checks. */
export function checkKind(kind: string): string {
  return CHECK_KINDS[kind] ?? humanize(kind);
}

const CI_SYSTEMS: Record<string, string> = {
  "github-actions": "GitHub Actions",
  "gitlab-ci": "GitLab CI",
  "azure-pipelines": "Azure Pipelines",
  "bitbucket-pipelines": "Bitbucket Pipelines",
  buildkite: "Buildkite",
  circleci: "CircleCI",
  drone: "Drone",
  jenkins: "Jenkins",
  travis: "Travis CI",
};

/** A CI system by its product name. */
export function ciSystem(system: string): string {
  return CI_SYSTEMS[system] ?? humanize(system);
}

const RUNTIMES: Record<string, string> = { node: "Node.js", npm: "npm", pnpm: "pnpm", yarn: "Yarn", bun: "Bun", deno: "Deno" };

/** A runtime or package manager whose version a repository declares. */
export function runtimeName(runtime: string): string {
  return RUNTIMES[runtime] ?? humanize(runtime);
}

// Kinds and mechanisms that fact values name, where the readable form isn't the identifier with spaces.
const KINDS: Record<string, string> = {
  "import-map": "Import map",
  "module-federation": "Module Federation",
  "native-federation": "Native Federation",
  "single-spa": "single-spa",
  iframe: "iframe",
  postMessage: "postMessage",
  openapi: "OpenAPI",
  graphql_schema: "GraphQL schema",
  graphql_operations: "GraphQL operations",
  graphql_interceptor: "GraphQL interceptor",
  // Service Dependency clients.
  fetch: "fetch",
  axios: "axios",
  websocket: "WebSocket",
  event_source: "EventSource",
  graphql: "GraphQL",
  generated: "Generated client",
  packaged: "Packaged client",
  host_adapter: "Host adapter",
};

/** The kind or mechanism a fact value names, such as a credential file or Module Federation. */
export function kindLabel(kind: string): string {
  return KINDS[kind] ?? humanize(kind);
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

/** A state's indicator alone, for a place that shows its label elsewhere, such as a section menu entry. */
export function StateIndicator({ state }: { state: string }) {
  const status = statusOf(state);
  return <Mark tone={status.tone} shape={status.indicator} />;
}
