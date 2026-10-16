/**
 * The Prototypes domain (prototypes/* specs). These shapes are stored as JSON
 * in the Prototypes database and passed between the pipeline, the pages, and
 * the render frame, so they hold only plain data.
 */

/**
 * What a version is: a page in the common shell, one component, or, for hero
 * generation only, one of a hero portal's microfrontends or its shell
 * (converge-templates-and-prototypes, design decision 6).
 */
export type Scope = "component" | "page" | "portal-member" | "portal-shell";

export const PORTAL_SCOPES: readonly Scope[] = ["portal-member", "portal-shell"];

export function isPortalScope(scope: Scope): boolean {
  return PORTAL_SCOPES.includes(scope);
}

/** What a design direction varies (generation spec, "Variants take distinct design directions"). */
export const AXES = ["information hierarchy", "density", "layout", "interaction model"] as const;
export type Axis = (typeof AXES)[number];

export interface Direction {
  readonly title: string;
  readonly sentence: string;
  readonly axis: Axis;
  /** The Salt pattern or composition recipe it starts from, when one fits. */
  readonly recipe: string | null;
}

export interface PersonaFields {
  readonly name: string;
  readonly role: string;
  readonly organizationType: string;
  readonly goals: readonly string[];
  readonly context: string;
  readonly constraints: readonly string[];
  /** How the persona differs from similar ones. */
  readonly distinction: string | null;
}

/** A persona as a version recorded it: editing or deleting the persona later leaves this copy alone. */
export interface PersonaCopy extends PersonaFields {
  readonly id: string;
}

/** A variant's progress (generation spec, "Variants generate in parallel and show progress"). */
export const STAGES = ["planning", "writing", "checking", "repairing", "rendering", "reviewing"] as const;
export type Stage = (typeof STAGES)[number];

export type VariantStatus = "running" | "ready" | "failed";

export interface Failure {
  /** Where it came from: the model service, the time limit, the checks after the repair limit, or the daily limit. */
  readonly kind: "model" | "timeout" | "checks" | "limit" | "internal";
  /** A reason the visitor can act on. */
  readonly message: string;
  /** For checks: the issues still failing. */
  readonly issues?: readonly GateIssue[];
}

export const GATES = ["typecheck", "salt-only", "salt-usage", "build"] as const;
export type GateName = (typeof GATES)[number];

export interface GateIssue {
  /** A stable code, such as TS2322 or salt-only/import. */
  readonly code: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  /** The symbol the issue is about, such as `Button.color`; with the gate and code, it makes the failure signature. */
  readonly symbol?: string;
  /** A suggested fix, such as Salt's validator's. */
  readonly fix?: string;
}

export interface GateResult {
  readonly gate: GateName;
  /** `not-run` when a gate's tooling was unavailable; it then warns instead of blocking. */
  readonly status: "passed" | "failed" | "not-run";
  readonly issues: readonly GateIssue[];
  readonly warnings: readonly GateIssue[];
  readonly durationMs: number;
  /** Issues a planted defect was allowed to cause, each with the planted rule that allowed it (portal-runtime spec, "Hero source passes DE FabLab's gates"). */
  readonly exempted?: readonly { readonly rule: string; readonly issue: GateIssue }[];
}

/** A planted rule, and the gate issue codes its defect may cause. */
export interface GateExemption {
  readonly rule: string;
  readonly codes: readonly string[];
}

export interface Attempt {
  readonly number: number;
  readonly gates: readonly GateResult[];
  readonly passed: boolean;
  readonly at: string;
  /** The Salt lookups the generator made in this attempt. */
  readonly lookups?: readonly SaltLookup[];
  /** The failure signatures of the gates that failed, for spotting recurring failures. */
  readonly signatures?: readonly string[];
}

export type Impact = "minor" | "moderate" | "serious" | "critical";

export interface AuditViolation {
  readonly rule: string;
  readonly impact: Impact;
  readonly description: string;
  readonly help: string;
  /** CSS selectors of the elements, as axe reports them, for highlighting in the preview. */
  readonly targets: readonly string[];
  readonly html: readonly string[];
}

export interface Audit {
  readonly at: string;
  readonly violations: readonly AuditViolation[];
}

export interface RenderError {
  readonly at: string;
  readonly message: string;
}

export type Score = 1 | 2 | 3 | 4 | 5 | "unknown";

/** The four general criteria (quality-checks spec, "A persona-fit review scores each version"). */
export const CRITERIA = [
  { id: "intent", label: "Serves the intent" },
  { id: "goals", label: "Puts the persona's goals first" },
  { id: "constraints", label: "Handles the persona's constraints" },
  { id: "clarity", label: "Information is clear" },
] as const;
export type CriterionId = (typeof CRITERIA)[number]["id"];

export interface Scored {
  readonly score: Score;
  readonly reason: string;
}

export interface Finding {
  readonly text: string;
  /** The part of the page it is about, when it can be tied to one. */
  readonly element: string | null;
}

export interface PersonaReview {
  readonly personaId: string;
  readonly personaName: string;
  readonly criteria: Readonly<Record<CriterionId, Scored>>;
  readonly checks: readonly (Scored & { readonly check: string })[];
  readonly strengths: readonly Finding[];
  readonly gaps: readonly (Finding & { readonly criterion: CriterionId | null })[];
}

export interface FitReview {
  readonly status: "reviewed" | "not-applicable" | "failed";
  /** The model that produced it, or null when no review ran. */
  readonly model: string | null;
  readonly personas: readonly PersonaReview[];
  /** Over every known score; null when every score is Unknown or no review ran. */
  readonly average: number | null;
  readonly at: string;
  readonly error?: string;
}

export const LESSON_CATEGORIES = ["Salt usage", "Layout", "Content", "Interaction", "Accessibility", "Persona need"] as const;
export type LessonCategory = (typeof LESSON_CATEGORIES)[number];

export type LessonScope = { readonly kind: "general" } | { readonly kind: "persona"; readonly personaId: string; readonly personaName: string };

/** A lesson as a version applied it. */
export interface LessonCopy {
  readonly id: string;
  readonly text: string;
  readonly scope: LessonScope;
  readonly category: LessonCategory;
}

/** One Salt registry lookup the generator made (generation spec, "Generation is grounded in Salt's own guidance"). */
export interface SaltLookup {
  readonly tool: string;
  readonly query: string;
  /** The components, patterns, and tokens the answer named. */
  readonly entries: readonly string[];
}

export interface Provenance {
  readonly model: string;
  readonly personas: readonly PersonaCopy[];
  /** The generation's intent. */
  readonly intent: string;
  /** The refinement message that produced this version, or null for a generated variant. */
  readonly message: string | null;
  readonly scope: Scope;
  readonly direction: Direction | null;
  readonly lessons: readonly LessonCopy[];
  readonly saltGuidance: readonly SaltLookup[];
  /** The Salt release the version rendered and was checked with, and the release its guidance described. */
  readonly saltRelease: string;
  readonly registryRelease: string;
  readonly kitVersion: string;
  readonly parentVersionId: string | null;
  readonly forkedFrom: { readonly prototypeId: string; readonly prototypeName: string; readonly versionId: string; readonly number: number } | null;
  /** The template and the template version Use template copied. */
  readonly startedFromTemplate: { readonly templateId: string; readonly title: string; readonly templateVersion: number | string } | null;
  /**
   * The hero template this version's lineage starts from, by slug: set by hero
   * generation and by Use template on a hero, and kept by forks, refinements,
   * and acceptances. It lets the version import `@deweb/portal`
   * (converge-templates-and-prototypes, design decision 5). Absent or null
   * everywhere else.
   */
  readonly hero?: string | null;
  /** Why a template shown as variant 0 uses its own sample data instead of the generation's, when it does. */
  readonly dataNote?: string | null;
  readonly createdAt: string;
}

/** An element a note is pinned to (preview spec, "Visitors can select an element in the preview"). */
export interface NotedElement {
  /** The nearest Salt component, or the element's role when no component name resolves. */
  readonly component: string;
  /** A CSS path from the prototype's root, so the pin finds the element again. */
  readonly locator: string;
  readonly text: string;
  /** A PNG data URL of the element. */
  readonly image: string | null;
}

export type NoteStatus = "open" | "addressed" | "resolved";

export interface ShellNavItem {
  readonly label: string;
  readonly children: readonly string[];
}

/** The page shell's contents (page-shell spec, "The shell's contents are workspace data"). */
export interface ShellConfig {
  readonly appName: string;
  readonly nav: readonly ShellNavItem[];
  readonly footerText: string;
  readonly footerLinks: readonly { readonly label: string; readonly href: string }[];
}

/** The fictional sample data every variant of a generation shares, as a TypeScript module's source. */
export interface SampleData {
  readonly description: string;
  readonly source: string;
}

export interface PairwiseVerdict {
  readonly personaId: string | null;
  readonly personaName: string;
  /** Which side better serves the intent after both orderings, or undecided when they disagree. */
  readonly winner: "a" | "b" | "undecided";
  readonly reasons: readonly string[];
}

/** The template gallery's brands, which an accepted template is filed under. */
export { BRAND_IDS, type BrandId } from "@/lib/demo/catalog/types";
