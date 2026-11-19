import type { JsonObject } from "@repo-facts/contract";
import { countLabel } from "@/components/ui/count";
import { type FactDocument, categoryDefinitions, categoryOf, categoryState, noValue, partial } from "./states";
import { SURVEYOR_RELEASE_LABEL } from "@/lib/product";

export interface AttentionItem {
  kind: "conflicting" | "unknown" | "partial" | "not_covered" | "skipped" | "diagnostics";
  label: string;
  reason: string;
  /** The section the item opens: a category id, or `diagnostics` or `other-diagnostics`. */
  section: string;
}

export interface Attention {
  /** How many categories are in each state, leaving out states no category has. */
  counts: { state: string; count: number }[];
  items: AttentionItem[];
  /** The sentence shown when there are no items. */
  empty: string | null;
}

const STATE_ORDER = ["observed", "inferred", "mixed", "conflicting", "unknown", "absent", "not_covered"];
export const NOTHING_NEEDS_ATTENTION = "Nothing needs attention: no category is conflicting, unknown, or not covered, and every input was read.";

/**
 * Everything the Profile couldn't establish, in one place: conflicting
 * categories, unknown categories with their reasons, partial categories,
 * whose facts came from only some of their inputs, categories the detector
 * release doesn't cover, skipped inputs, and other diagnostics.
 */
export function attention(document: FactDocument, diagnostics: { skipped: readonly JsonObject[]; notes: readonly JsonObject[] }, hidden: ReadonlySet<string> = new Set()): Attention {
  // Categories whose view doesn't apply to this repository, such as Design system for a service, aren't counted or listed.
  const definitions = categoryDefinitions(document).filter((definition) => !hidden.has(definition.id));
  const tally = new Map<string, number>();
  for (const definition of definitions) tally.set(categoryState(document, definition.id), (tally.get(categoryState(document, definition.id)) ?? 0) + 1);
  const counts = [...tally.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([state, count]) => ({ state, count }));

  const items: AttentionItem[] = [];
  for (const definition of definitions) {
    const category = categoryOf(document, definition.id);
    const conflicts = category?.facts.filter((fact) => fact.state === "conflicting") ?? [];
    if (category?.state === "conflicting" || conflicts.length) {
      items.push({ kind: "conflicting", label: definition.label, reason: `${countLabel(conflicts.length, "fact")} with conflicting candidates: ${conflicts.map((fact) => fact.key).join(", ")}`, section: definition.id });
    }
  }
  for (const definition of definitions) {
    if (categoryState(document, definition.id) === "unknown") items.push({ kind: "unknown", label: definition.label, reason: noValue(document, definition).reason, section: definition.id });
  }
  for (const definition of definitions) {
    const reason = partial(document, definition.id);
    if (reason) items.push({ kind: "partial", label: definition.label, reason, section: definition.id });
  }
  const uncovered = definitions.filter((definition) => categoryState(document, definition.id) === "not_covered");
  if (uncovered.length) {
    items.push({ kind: "not_covered", label: uncovered.map((definition) => definition.label).join(", "), reason: `${SURVEYOR_RELEASE_LABEL} ${document.detector_release} doesn't report ${uncovered.length === 1 ? "this category" : "these categories"}`, section: uncovered[0]!.id });
  }
  if (diagnostics.skipped.length) items.push({ kind: "skipped", label: countLabel(diagnostics.skipped.length, "skipped input"), reason: "Facts they could affect are unknown, never absent", section: "diagnostics" });
  if (diagnostics.notes.length) items.push({ kind: "diagnostics", label: countLabel(diagnostics.notes.length, "other diagnostic"), reason: "Inconsistencies and unsupported constructs, noted without skipping the input", section: "other-diagnostics" });

  return { counts, items, empty: items.length ? null : NOTHING_NEEDS_ATTENTION };
}

const rank = (state: string) => (STATE_ORDER.includes(state) ? STATE_ORDER.indexOf(state) : STATE_ORDER.length);
