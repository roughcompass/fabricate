import styles from "./status.module.css";

/**
 * The single registry for how states, outcomes, severities, and other
 * enumerated values are shown: every value has one label, one tone, and one
 * indicator, and operators never see a raw identifier.
 */

export type Tone = "neutral" | "success" | "warning" | "error" | "progress";

/** The indicator's shape. The states that carry no value each have their own, so they differ without their labels. */
export type Indicator = "dot" | "ring" | "dash";

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
  inferred: ["Inferred", "progress"],
  mixed: ["Mixed", "progress"],
  conflicting: ["Conflicting", "warning"],
  unknown: ["Unknown", "neutral", "ring"],
  absent: ["None detected", "neutral"],
  // A category that the Profile's detector release didn't define.
  not_covered: ["Not covered", "neutral", "dash"],
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

export function statusOf(state: string): { label: string; tone: Tone; indicator: Indicator } {
  const [label, tone, indicator = "dot"] = STATES[state] ?? [humanize(state), "neutral"];
  return { label, tone, indicator };
}

export function statusLabel(state: string): string {
  return statusOf(state).label;
}

/** A colored indicator beside a text label; never color alone. */
export function Status({ state, label, size = "md" }: { state: string; label?: string; size?: "sm" | "md" }) {
  const status = statusOf(state);
  return (
    <span className={styles.status} data-tone={status.tone} data-size={size}>
      <span className={styles.dot} data-indicator={status.indicator} aria-hidden="true" />
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
