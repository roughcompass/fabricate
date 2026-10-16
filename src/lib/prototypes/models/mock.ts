import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { AXES } from "../types";
import { MOCK_DATA, mockBrokenPage, mockComponent, mockPage, mockPortalMember, mockPortalShell } from "./mock-fixtures";
import type { ModelRole } from "./index";

/**
 * The scripted model (design.md, decision 16): `prototypes.models.* = mock`.
 * It answers each step from what the step's prompt says, so browser tests run
 * the real pipeline, gates, and storage with no model service. The prompts
 * carry labeled lines ("Scope:", "Variants:", "Direction:", "Persona …:")
 * that the mock reads. Markers in an intent or message script failures:
 *
 * - `#mock-fail-once`: the first attempt fails the typecheck; the repair passes.
 * - `#mock-fail-always`: every attempt fails the typecheck.
 * - `#mock-fail-variant-2`: every attempt of the second direction fails the typecheck.
 * - `#mock-model-error`: the model service fails.
 * - `#mock-position-bias`: pairwise reviews prefer whichever version comes first.
 */

type CallOptions = Parameters<MockLanguageModelV4["doGenerate"]>[0];
type Result = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 50, text: 50, reasoning: undefined },
};

/** Every text in the prompt, in order: instructions, messages, and tool results. */
export function promptText(options: CallOptions): string {
  return options.prompt
    .flatMap((message) => {
      if (message.role === "system") return [message.content];
      return message.content.flatMap((part) => {
        if (part.type === "text") return [part.text];
        if (part.type === "tool-result") return [JSON.stringify(part.output)];
        return [];
      });
    })
    .join("\n");
}

/** The value of the first line that starts with `label:`. */
function line(text: string, label: string): string | undefined {
  const prefix = `${label}:`;
  return text
    .split("\n")
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
}

function json(value: unknown): Result {
  return { content: [{ type: "text", text: JSON.stringify(value) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
}

function toolCall(name: string, input: unknown, id: string): Result {
  return { content: [{ type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(input) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] };
}

function fail(text: string): void {
  if (text.includes("#mock-model-error")) throw new APICallError({ message: "The mock model service is unavailable", url: "mock://model", requestBodyValues: {}, statusCode: 503, isRetryable: false });
}

const DIRECTIONS = [
  { title: "Exception-first queue", sentence: "Payments that need action lead, sorted by cut-off.", axis: AXES[0], recipe: "Table" },
  { title: "Compact approval grid", sentence: "Every payment on one dense screen, with status at a glance.", axis: AXES[1], recipe: "Table" },
  { title: "Cut-off timeline", sentence: "Payments grouped by cut-off time, earliest first.", axis: AXES[2], recipe: "Vertical navigation" },
  { title: "Guided release", sentence: "One payment at a time, with the next step always in view.", axis: AXES[3], recipe: "Wizard" },
  { title: "Payee-first summary", sentence: "Payments grouped by payee, with each payee's total first.", axis: AXES[0], recipe: "Table" },
  { title: "Spacious review cards", sentence: "One roomy card per payment, readable on a phone.", axis: AXES[1], recipe: "Card" },
  { title: "Split detail view", sentence: "The queue on the left and the chosen payment's details on the right.", axis: AXES[2], recipe: "Side panel" },
  { title: "Bulk release", sentence: "Select several payments and release them in one confirmed step.", axis: AXES[3], recipe: "Table" },
] as const;

function plan(text: string): Result {
  fail(text);
  const count = Math.min(DIRECTIONS.length, Math.max(1, Number.parseInt(line(text, "Variants") ?? "1", 10) || 1));
  return json({ directions: DIRECTIONS.slice(0, count), sampleData: { description: "Four fictional supplier payments due today, in USD, EUR, and GBP.", source: MOCK_DATA } });
}

function write(options: CallOptions, text: string): Result {
  fail(text);
  const lookups = options.prompt.filter((message) => message.role === "tool").length;
  if (lookups === 0) return toolCall("get_component", { name: "Table" }, "mock-lookup");
  const scopeLine = line(text, "Scope");
  const scope = scopeLine === "component" ? "component" : scopeLine === "portal microfrontend" ? "portal-member" : scopeLine === "portal shell" ? "portal-shell" : "page";
  const title = line(text, "Direction") ?? line(text, "Title") ?? "Urgent payments";
  const repairing = text.includes("The gates failed");
  const broken = text.includes("#mock-fail-always") || (text.includes("#mock-fail-variant-2") && title === DIRECTIONS[1].title) || (text.includes("#mock-fail-once") && !repairing);
  const notes = [...new Set(text.match(/fbk_[a-z0-9]{16}/g) ?? [])];
  // A refinement shows the change it was asked for, so versions differ the way the message says.
  const asked = line(text, "Message");
  // A hero member lists the records of the shared data's first exported array.
  const records = /export const ([A-Za-z_][A-Za-z0-9_]*)\s*:\s*readonly/.exec(text.slice(text.indexOf("Sample data")))?.[1];
  const code = scope === "portal-shell" ? mockPortalShell() : scope === "portal-member" ? mockPortalMember(title, line(text, "Member") ?? "member", records) : scope === "component" ? mockComponent(title) : broken ? mockBrokenPage(title) : mockPage(title, notes.length ? "Payments over USD 1m need a confirmation step." : (asked ?? ""));
  return toolCall(
    "submit_prototype",
    {
      code,
      title,
      navItem: scope === "page" ? "Approvals" : null,
      summary: repairing ? "Removed the property Salt's Button doesn't have." : `Built the ${title.toLowerCase()} from Salt's Table pattern.`,
      addressedNotes: notes.map((noteId) => ({ noteId, addressed: true, how: "Added a confirmation step for amounts over USD 1m." })),
    },
    "mock-submit",
  );
}

function review(text: string): Result {
  fail(text);
  const personas = [...text.matchAll(/^Persona (per_[a-z0-9]{16}): (.+)$/gm)].map((match) => ({ personaId: match[1]!, personaName: match[2]!.trim() }));
  const scored = (score: number | "unknown", reason: string) => ({ score, reason });
  return json({
    personas: personas.map((persona) => ({
      ...persona,
      criteria: {
        intent: scored(4, "The queue shows what needs releasing today."),
        goals: scored(5, "Payments that need action lead."),
        constraints: scored(4, "Four-eyes state is shown for large payments."),
        // Showing totals scores higher, so a refinement that adds them is marked higher on the compare page.
        clarity: text.toLowerCase().includes("total") ? scored(5, "Amounts carry currency codes, and the totals are shown.") : scored(4, "Amounts carry currency codes."),
      },
      checks: [scored(5, "Cut-off times are visible in every row."), scored(4, "Approval state is visible."), scored(4, "Amounts are right-aligned.")].map((entry, index) => ({ ...entry, check: ["Cut-off times are visible", "Four-eyes approval state is shown", "Amounts are easy to compare"][index]! })),
      strengths: [{ text: "Status uses Salt's status indicator with a label.", element: "Status column" }],
      gaps: [{ text: "Totals per cut-off aren't shown.", element: "Table", criterion: "goals" }],
    })),
  });
}

function learn(text: string): Result {
  fail(text);
  const citations = [...new Set(text.match(/fbk_[a-z0-9]{16}/g) ?? [])];
  const failure = line(text, "Recurring failure");
  const feedback = line(text, "Feedback")?.replace(/\s*\(fbk_[^)]*\)\s*$/, "");
  const proposals = [];
  if (failure) proposals.push({ kind: "new", text: "Don't pass size to Salt's Button; it has no size property.", scope: { kind: "general" }, category: "Salt usage", citations: [], failures: [failure] });
  if (feedback) proposals.push({ kind: "new", text: `For approval queues, ${feedback.replace(/^[A-Z]/, (letter) => letter.toLowerCase()).replace(/\.$/, "")}.`.slice(0, 280), scope: { kind: "general" }, category: "Content", citations, failures: [] });
  return json({ proposals });
}

function pairwise(text: string): Result {
  fail(text);
  const personas = [...text.matchAll(/^Persona (per_[a-z0-9]{16}|none): (.+)$/gm)].map((match) => ({ personaId: match[1] === "none" ? null : match[1]!, personaName: match[2]!.trim() }));
  const a = Number.parseInt(line(text, "Version A") ?? "0", 10);
  const b = Number.parseInt(line(text, "Version B") ?? "0", 10);
  const winner = text.includes("#mock-position-bias") ? "a" : a >= b ? "a" : "b";
  // Each side's name follows its "Version" line; reasons use it, never A or B.
  const names = [...text.matchAll(/^Name: (.+)$/gm)].map((match) => match[1]!.trim());
  const named = (winner === "a" ? names[0] : names[1]) ?? `Version ${winner.toUpperCase()}`;
  return json({ verdicts: (personas.length ? personas : [{ personaId: null, personaName: "The intent" }]).map((persona) => ({ ...persona, winner, reasons: [`${named} keeps the cut-off in view.`] })) });
}

/** A mock model for one step. */
export function mockModel(role: ModelRole | "pairwise"): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: `mock-${role}`,
    doGenerate: async (options) => {
      const text = promptText(options);
      if (role === "plan") return plan(text);
      if (role === "generate") return write(options, text);
      if (role === "learn") return learn(text);
      return text.includes("Pairwise review") ? pairwise(text) : review(text);
    },
  });
}
