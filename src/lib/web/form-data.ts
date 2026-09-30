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
