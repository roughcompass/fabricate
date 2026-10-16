import { z } from "zod";
import type { ValidationError } from "@/lib/db/errors";

/**
 * Helpers for Server Actions, which are reachable by direct POST requests:
 * every input is read through a typed, length-bounded schema before any
 * application code sees it.
 */

export function text(formData: FormData, name: string, max = 2_000): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

export function texts(formData: FormData, name: string, max = 200, limit = 500): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string")
    .slice(0, limit)
    .map((value) => value.slice(0, max))
    .filter((value) => value !== "");
}

export function integer(formData: FormData, name: string): number | null {
  const parsed = z.coerce.number().int().min(0).max(2 ** 31).safeParse(formData.get(name));
  return parsed.success ? parsed.data : null;
}

/** Field-addressed messages for a form state. */
export function errorsFrom(error: ValidationError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) (errors[issue.field] ??= []).push(issue.message);
  return errors;
}

/** Every submitted field, as a refused form keeps it to show again. Fields named with "$", which React adds, are left out. */
export function submittedValues(formData: FormData): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const [key, entry] of formData.entries()) {
    if (typeof entry !== "string" || key.startsWith("$") || key.length > 200) continue;
    const existing = values[key];
    if (existing === undefined) values[key] = entry.slice(0, 5_000);
    else values[key] = [...(Array.isArray(existing) ? existing : [existing]), entry.slice(0, 5_000)].slice(0, 500);
  }
  return values;
}
