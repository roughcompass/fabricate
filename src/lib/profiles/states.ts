import { type CategoryDefinition, type JsonObject, type JsonValue, SHARED_CATEGORIES } from "@repo-facts/contract";
import { countLabel } from "@/components/ui/count";
import { humanize } from "@/components/ui/status";

/** A candidate value of a conflicting fact, with its own evidence. */
export interface Candidate {
  value: JsonValue;
  evidence: string[];
  rule: string;
}

export interface Fact {
  key: string;
  state: string;
  value: JsonValue;
  evidence: string[];
  rule: string;
  reasoning?: string;
  candidates?: Candidate[];
}

/** What a category's detectors searched: the rules, the paths they examined, and anything skipped. */
export interface Search {
  complete: boolean;
  skipped: string[];
  surface: string[];
  rules: string[];
}

export interface Category {
  state: string;
  facts: Fact[];
  search: Search;
}

/** The embedded repo-facts fact document, as far as the profile view reads it. */
export interface FactDocument {
  detector_release: string;
  categories: Record<string, Category>;
  extensions?: { id: string; bounded_negative: boolean }[];
  evidence: JsonObject;
  service_dependencies?: JsonObject[];
  diagnostics?: JsonObject[];
  inventory?: { files?: number; files_read?: number };
}

/** A state with no value and why, as a placeholder shows it. */
export interface NoValue {
  state: "absent" | "unknown" | "not_covered";
  reason: string;
}

/**
 * Every category a document can hold: the shared categories of the installed
 * contract, then the document's own extension categories, which name no label
 * or group of their own.
 */
export function categoryDefinitions(document: FactDocument): CategoryDefinition[] {
  const extensions = (document.extensions ?? []).map(
    (extension): CategoryDefinition => ({ id: extension.id, label: humanize(extension.id.slice(extension.id.indexOf(".") + 1)), group: "Extensions", boundedNegative: extension.bounded_negative, description: `Reported by the ${extension.id.slice(0, extension.id.indexOf("."))} extension` }),
  );
  return [...SHARED_CATEGORIES, ...extensions];
}

export function categoryOf(document: FactDocument, id: string): Category | undefined {
  return Object.hasOwn(document.categories, id) ? document.categories[id] : undefined;
}

/** A category's state. A category the document doesn't contain is not covered, never unknown or none detected. */
export function categoryState(document: FactDocument, id: string): string {
  return categoryOf(document, id)?.state ?? "not_covered";
}

/**
 * Why a category has no value, in a short clause that follows its state's
 * label: what its search covered, what it skipped, or that the detector
 * release didn't report it.
 */
export function noValue(document: FactDocument, definition: CategoryDefinition): NoValue {
  const category = categoryOf(document, definition.id);
  if (!category) return { state: "not_covered", reason: `Detector release ${document.detector_release} doesn't report this category` };
  const { search } = category;
  if (category.state === "absent") {
    return { state: "absent", reason: search.surface.length ? `After a complete search of ${countLabel(search.surface.length, "input")}` : "No input this category reads exists in this commit" };
  }
  if (search.skipped.length) {
    // A few paths say which files; Skipped inputs lists every one, with why.
    const named = search.skipped.slice(0, 3).join(", ");
    const rest = search.skipped.length > 3 ? `, and ${search.skipped.length - 3} more in Skipped inputs` : "";
    return { state: "unknown", reason: `${countLabel(search.skipped.length, "relevant input")} could not be read or understood: ${named}${rest}` };
  }
  if (search.complete && search.surface.length && !definition.boundedNegative) {
    return { state: "unknown", reason: `Searched ${countLabel(search.surface.length, "input")} and found none, but committed files cannot prove there is none` };
  }
  return { state: "unknown", reason: "No bounded search can establish this category from committed files" };
}
