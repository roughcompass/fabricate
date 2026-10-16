"use server";

import { notFound, redirect } from "next/navigation";
import { text } from "@/lib/web/form-data";

/** Server Actions behind the gallery's demos. Like the gallery, they refuse to run in production. */

function developmentOnly(): void {
  if (process.env.NODE_ENV === "production") notFound();
}

export async function noopDemo(): Promise<void> {
  developmentOnly();
}

/** Stands in for a confirmed action: it redirects with an outcome code, as real actions do. */
export async function confirmDemo(): Promise<void> {
  developmentOnly();
  redirect("/design-system?notice=confirmed#dialog");
}

export interface DemoFormState {
  values: { name: string };
  errors: Partial<Record<"name" | "base", string[]>>;
}

/** Rejects an empty name as a field error, and "stale" as an error about the whole form. */
export async function validateDemo(_previous: DemoFormState, formData: FormData): Promise<DemoFormState> {
  developmentOnly();
  const name = text(formData, "name", 100);
  if (!name.trim()) return { values: { name }, errors: { name: ["Enter a name."] } };
  if (name === "stale") return { values: { name }, errors: { base: ["This record was changed by someone else. Reload the page to see the current values."] } };
  redirect("/design-system?notice=demo#feedback");
}

/** Stands in for sending a refinement: an empty message is a field error, and anything else reports that the gallery sends nothing. */
export async function composerDemo(_previous: { values: { message: string }; errors: Partial<Record<"message" | "base", string[]>> }, formData: FormData): Promise<{ values: { message: string }; errors: Partial<Record<"message" | "base", string[]>> }> {
  developmentOnly();
  const message = text(formData, "message", 2_000);
  if (!message.trim()) return { values: { message }, errors: { message: ["Say what to change."] } };
  return { values: { message }, errors: { base: ["The gallery doesn't send messages."] } };
}
