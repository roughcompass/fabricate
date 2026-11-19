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

/** Stands in for discarding a flow's values: it opens the Flow template's example at its first step, empty. */
export async function discardFlowDemo(): Promise<void> {
  developmentOnly();
  redirect("/design-system#template-flow");
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
