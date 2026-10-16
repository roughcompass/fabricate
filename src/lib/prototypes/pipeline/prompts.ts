import type { AuditViolation, Direction, GateResult, LessonCopy, PersonaCopy, RenderError, SampleData, Scope, ShellConfig } from "../types";

/**
 * The prompts each model step sends. They state their inputs as labeled
 * lines ("Scope:", "Variants:", "Direction:", "Persona …:"), which keeps them
 * readable in the provenance and lets the scripted mock model answer them.
 * Personas, intents, and code are the only workspace data that leave DE
 * FabLab (proposal, "Data handling").
 */

const SCOPES: Record<Scope, string> = { page: "page", component: "component", "portal-member": "portal microfrontend", "portal-shell": "portal shell" };

export function personaLines(personas: readonly PersonaCopy[]): string {
  if (personas.length === 0) return "Personas: none. Design for a typical user of a corporate banking portal.";
  return personas
    .map((persona) =>
      [
        `Persona ${persona.id}: ${persona.name}`,
        `  Role: ${persona.role}${persona.organizationType ? `, ${persona.organizationType}` : ""}`,
        `  Goals: ${persona.goals.join("; ")}`,
        persona.context && `  Context: ${persona.context}`,
        persona.constraints.length > 0 && `  Constraints: ${persona.constraints.join("; ")}`,
        persona.distinction && `  Differs from similar personas: ${persona.distinction}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
}

function shellLines(scope: Scope, shell: ShellConfig): string {
  if (scope === "component") return "The component renders alone, with no page shell.";
  const items = shell.nav.map((item) => (item.children.length ? `${item.label} (${item.children.join(", ")})` : item.label)).join("; ");
  return `Shell application: ${shell.appName}\nShell navigation items: ${items}`;
}

export interface PlanInput {
  readonly intent: string;
  readonly scope: Scope;
  readonly personas: readonly PersonaCopy[];
  readonly variants: number;
  readonly shell: ShellConfig;
  readonly lessons: readonly LessonCopy[];
  /** The attached template, which is variant 0: the directions vary from it, and the data takes its shape (design decision 8 of converge-templates-and-prototypes). */
  readonly template?: { readonly title: string; readonly data: SampleData } | null;
}

/** The plan step (generation spec, "Variants take distinct design directions" and "Variants of a generation share one sample data set"). */
export function planPrompt(input: PlanInput): string {
  return [
    `Plan ${input.variants} distinct Salt design directions for this request, and one fictional sample data set every direction will use.`,
    `Intent: ${input.intent}`,
    `Scope: ${SCOPES[input.scope]}`,
    `Variants: ${input.variants}`,
    personaLines(input.personas),
    shellLines(input.scope, input.shell),
    input.lessons.length > 0 ? `Lessons to respect:\n${input.lessons.map((lesson) => `- ${lesson.text}`).join("\n")}` : "",
    input.template
      ? [
          `Template: ${input.template.title} is variant 0 of this generation, unchanged. Plan only the other ${input.variants} directions.`,
          "- Each direction varies one axis from the template; its sentence says what it changes compared with the template.",
          `- The sample data must keep the template's data shape exactly, so the template renders it unchanged: the same exported names, interfaces, and field types, with new rows for this intent. The template's data module (${input.template.data.description}):\n\`\`\`ts\n${input.template.data.source}\n\`\`\``,
        ].join("\n")
      : "",
    [
      "Directions:",
      `- Give exactly ${input.variants}. No two may be alike. Each varies one axis: information hierarchy, density, layout, or interaction model. ${input.variants <= 4 ? "Give each direction a different axis." : "Use every axis before any axis repeats, and make directions on the same axis differ clearly."}`,
      "- Each has a short title, such as 'Exception-first queue', and one sentence saying what it does differently.",
      "- Name the Salt pattern or component it starts from as its recipe, such as 'Table', 'Vertical navigation', 'Metric', or 'Wizard', or null.",
      "Sample data:",
      "- A TypeScript module, imported by every variant as ./data. Export typed, readonly constants and the interfaces for them; no functions with side effects, no imports except type-only imports from @salt-ds/core.",
      "- Realistic and fictional for a financial institution: ISO currency codes with formatted amounts, dates such as 16 Oct 2026, cut-off times with their zone, masked account numbers.",
      "- Enough rows to show the design: 5 to 12 for a list.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface WriteInput {
  readonly intent: string;
  readonly scope: Scope;
  readonly personas: readonly PersonaCopy[];
  readonly direction: Direction | null;
  readonly data: SampleData;
  readonly shell: ShellConfig;
  /** The attached template, as a reference this direction varies from. */
  readonly template?: { readonly title: string; readonly code: string } | null;
  /** For hero generation: the microfrontend's id, which it uses on the bus. */
  readonly member?: string | null;
  /** For hero generation: the hand-written source this version ports to Salt. */
  readonly reference?: string | null;
}

/** What a hero version ports, when it ports one: everything it must keep, then the hand-written source. */
function referenceLines(input: Pick<WriteInput, "reference">): string {
  if (!input.reference) return "";
  return [
    "Port: rebuild the hand-written version below with Salt. Keep exactly what it shows and does: every visible text, heading, label, and accessible name; every record and value; every bus topic, payload, and member id; every data-demo-anchor attribute and its value, on the element that has it, which Salt components pass through; and its behavior for each persona. Replace the runtime's own components, such as Panel, Table, Th, Td, Tr, Field, TextInput, Select, Button, Badge, Stat, Muted, Icon, and uiStyles classes, with Salt's components, layouts, and tokens. Never write a raw element Salt has a component for: no <button>, <a>, <input>, <select>, or <textarea>; a list of selectable records uses Salt's Button, ToggleButton, or InteractableCard, not a styled button. Text inside a button or toggle button uses color=\"inherit\", so it keeps contrast when the button is selected. Its records now come from ./data, under the same names.",
    input.reference,
  ].join("\n");
}

/** The first attempt for a generated variant. */
export function writePrompt(input: WriteInput): string {
  return [
    `Write the ${SCOPES[input.scope]} for this request${input.direction ? ", following its design direction" : ""}.`,
    `Intent: ${input.intent}`,
    `Scope: ${SCOPES[input.scope]}`,
    input.member ? `Member: ${input.member}` : "",
    input.direction ? `Direction: ${input.direction.title}\nDirection detail: ${input.direction.sentence} It varies the ${input.direction.axis}.${input.direction.recipe ? ` Start from Salt's ${input.direction.recipe}.` : ""}` : "",
    personaLines(input.personas),
    shellLines(input.scope, input.shell),
    `Sample data (./data), ${input.data.description}:\n\`\`\`ts\n${input.data.source}\n\`\`\``,
    referenceLines(input),
    input.template ? `Reference: the template ${input.template.title}, which is variant 0 of this generation. Start from it and change what the direction says; don't return it unchanged.\n\`\`\`tsx\n${input.template.code}\n\`\`\`` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface RefineInput extends WriteInput {
  readonly message: string;
  readonly base: { readonly number: number; readonly code: string };
  readonly feedback: readonly { readonly kind: string; readonly text: string; readonly rating: number | null }[];
  readonly notes: readonly { readonly id: string; readonly text: string; readonly component: string; readonly elementText: string }[];
  readonly violations: readonly AuditViolation[];
  readonly renderError: RenderError | null;
}

/** A refinement (generation spec, "Refinements create new versions"), built on the version shown. */
export function refinePrompt(input: RefineInput): string {
  return [
    `Change version ${input.base.number} as the message asks, keeping everything else. Keep its sample data unless the message asks to change it.`,
    `Message: ${input.message}`,
    `Intent: ${input.intent}`,
    `Scope: ${SCOPES[input.scope]}`,
    input.member ? `Member: ${input.member}` : "",
    input.direction ? `Direction: ${input.direction.title}` : "",
    referenceLines(input),
    personaLines(input.personas),
    shellLines(input.scope, input.shell),
    input.feedback.length > 0 ? `Feedback on version ${input.base.number}:\n${input.feedback.map((entry) => `- ${entry.kind}${entry.rating ? ` ${entry.rating}/5` : ""}: ${entry.text}`).join("\n")}` : "",
    input.notes.length > 0
      ? `Open notes on version ${input.base.number}; for each, say in addressedNotes whether you addressed it and how:\n${input.notes.map((note) => `- Open note ${note.id} on the ${note.component}${note.elementText ? ` "${note.elementText}"` : ""}: ${note.text}`).join("\n")}`
      : "",
    input.violations.length > 0 ? `Accessibility audit findings to fix:\n${input.violations.map((violation) => `- ${violation.rule} (${violation.impact}): ${violation.help}, at ${violation.targets.join(", ")}`).join("\n")}` : "",
    input.renderError ? `Version ${input.base.number} threw while rendering: ${input.renderError.message}. Fix the cause.` : "",
    `Sample data (./data):\n\`\`\`ts\n${input.data.source}\n\`\`\``,
    `Version ${input.base.number}'s code:\n\`\`\`tsx\n${input.base.code}\n\`\`\``,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** A repair (quality-checks spec, "Failed gates are repaired automatically"): the gate results, with Salt's fix recipes. */
export function repairPrompt(code: string, results: readonly GateResult[], recipes: readonly string[]): string {
  const failures = results
    .filter((result) => result.status === "failed")
    .flatMap((result) => result.issues.map((issue) => `- ${result.gate}${issue.line ? ` line ${issue.line}` : ""}: ${issue.message}${issue.fix ? ` Fix: ${issue.fix}` : ""}`));
  return [
    "The gates failed on the code you submitted. Fix every failure below, change nothing else, and submit the complete file again.",
    failures.join("\n"),
    recipes.length > 0 ? `Salt's fix recipes:\n${recipes.map((recipe) => `- ${recipe}`).join("\n")}` : "",
    `Your code:\n\`\`\`tsx\n${code}\n\`\`\``,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface ReviewInput {
  readonly intent: string;
  readonly scope: Scope;
  readonly personas: readonly PersonaCopy[];
  readonly direction: Direction | null;
  readonly code: string;
  readonly data: string;
}

/** The persona-fit review (quality-checks spec; design.md, decision 10). */
export function reviewPrompt(input: ReviewInput): string {
  return [
    "Review this Salt prototype against each persona. You see only its code and data, not a screenshot: score Unknown whenever the code can't show something.",
    `Intent: ${input.intent}`,
    `Scope: ${SCOPES[input.scope]}`,
    input.direction ? `Direction: ${input.direction.title}: ${input.direction.sentence}` : "",
    personaLines(input.personas),
    [
      "For each persona:",
      "- Score four criteria from 1 to 5, or unknown, each with a one-sentence reason: intent (serves the intent), goals (puts the persona's goals first), constraints (handles the persona's constraints), clarity (its information is clear).",
      "- Derive 3 to 5 checks specific to this intent and persona, such as 'Cut-off times are visible', and score each the same way.",
      "- List strengths and gaps, each tied to the part of the page it is about where possible. Give each gap the criterion it lowers.",
      "Be strict: a 5 means nothing important is missing.",
    ].join("\n"),
    `Sample data:\n\`\`\`ts\n${input.data}\n\`\`\``,
    `Code:\n\`\`\`tsx\n${input.code}\n\`\`\``,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface PairwiseSide {
  readonly label: string;
  readonly number: number;
  /** What the page calls the version, such as "v3", which reasons use instead of A or B. */
  readonly name?: string;
  readonly code: string;
}

/** One ordering of a pairwise review (quality-checks spec, "Two versions can be judged pairwise on request"). */
export function pairwisePrompt(intent: string, personas: readonly PersonaCopy[], a: PairwiseSide, b: PairwiseSide): string {
  const people = personas.length ? personas.map((persona) => `Persona ${persona.id}: ${persona.name}, ${persona.role}. Goals: ${persona.goals.join("; ")}`).join("\n") : "Persona none: a typical user";
  return [
    "Pairwise review. Compare versions A and B for each persona: which better serves the intent? Answer a, b, or undecided when neither is clearly better, with reasons tied to parts of the pages.",
    "A and B are only positions. In reasons, call each version by its name given below, never A or B.",
    `Intent: ${intent}`,
    people,
    `Version A: ${a.number}\nName: ${a.name ?? `v${a.number}`}\n\`\`\`tsx\n${a.code}\n\`\`\``,
    `Version B: ${b.number}\nName: ${b.name ?? `v${b.number}`}\n\`\`\`tsx\n${b.code}\n\`\`\``,
  ].join("\n\n");
}

export interface LearnInput {
  readonly feedback: readonly { readonly id: string; readonly kind: string; readonly text: string; readonly personas: readonly PersonaCopy[] }[];
  readonly failures: readonly { readonly signature: string; readonly message: string }[];
  readonly lessons: readonly (LessonCopy & { readonly status: string })[];
}

/** Proposing lessons (learning spec, "The agent proposes lessons from feedback and checks"). */
export function learnPrompt(input: LearnInput): string {
  return [
    "Propose zero to three lessons a prototype generator should follow from now on, from the feedback and recurring check failures below.",
    [
      "Each lesson is one imperative sentence of at most 280 characters, general or for one persona, with a category: Salt usage, Layout, Content, Interaction, Accessibility, or Persona need.",
      "Cite the feedback ids or failure signatures each lesson comes from.",
      "When a lesson resembles an existing one, propose an edit to it (kind edit, with its id). When it contradicts an active lesson, propose it as a conflict with that lesson's id. Otherwise kind new.",
      "Propose nothing for feedback that doesn't generalize.",
    ].join("\n"),
    input.feedback.map((entry) => `Feedback: ${entry.text} (${entry.id}, ${entry.kind}${entry.personas.length ? `, for ${entry.personas.map((persona) => `${persona.name} ${persona.id}`).join(", ")}` : ""})`).join("\n"),
    input.failures.map((failure) => `Recurring failure: ${failure.signature}\n  ${failure.message}`).join("\n"),
    input.lessons.length > 0 ? `Existing lessons:\n${input.lessons.map((lesson) => `- ${lesson.id} (${lesson.status}, ${lesson.category}): ${lesson.text}`).join("\n")}` : "Existing lessons: none.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
