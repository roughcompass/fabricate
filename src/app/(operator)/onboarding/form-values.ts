import type { DraftValues } from "@/components/onboarding/draft-form";
import { text, texts } from "@/lib/web/form-data";

/*
 * Reading Draft forms. Rows of a list, such as a Portal's menu groups, are
 * named "menu.0.key", "menu.1.key", and so on; a form holds the indices of
 * the rows it shows in "menu.rows". Every value
 * is read through a bounded helper, since a Server Action can be posted
 * directly.
 */

/** The row indices a form submitted for +list+, in order. */
export function rowIndices(formData: FormData, list: string): number[] {
  return texts(formData, `${list}.rows`, 6, 200)
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < 1000);
}

/** Every submitted field, as the form state keeps it to show again. */
export function submittedValues(formData: FormData): DraftValues {
  const values: DraftValues = {};
  for (const [key, entry] of formData.entries()) {
    if (typeof entry !== "string" || key.startsWith("$") || key.length > 200) continue;
    const existing = values[key];
    if (existing === undefined) values[key] = entry.slice(0, 5_000);
    else values[key] = [...(Array.isArray(existing) ? existing : [existing]), entry.slice(0, 5_000)].slice(0, 500);
  }
  return values;
}

/** Lines of a text area, trimmed, without blanks. */
export function lines(formData: FormData, name: string, max = 20_000): string[] {
  return text(formData, name, max)
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 200);
}

/** A checkbox's state. */
export function checked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

/** The intent a submit button carried: "save", "add:menu", "remove:menu:2". */
export function intentOf(formData: FormData): { kind: "save" | "continue" | "add" | "remove"; list: string | null; index: number | null } {
  const intent = text(formData, "intent", 100);
  const [kind, list, index] = intent.split(":");
  if (kind === "add" && list) return { kind, list, index: null };
  if (kind === "remove" && list && /^\d+$/.test(index ?? "")) return { kind, list, index: Number(index) };
  return { kind: kind === "continue" ? "continue" : "save", list: null, index: null };
}
