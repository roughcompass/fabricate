"use server";

import { redirect } from "next/navigation";
import { requireDemo } from "@/lib/demo/guard";
import { routePrompt } from "@/lib/demo/prompt";
import { text } from "@/lib/web/form-data";
import type { PromptState } from "./form-state";

/** The prompt bar: a description opens the gallery searched for it, a demo BitBucket URL opens its import. */
export async function submitPrompt(_previous: PromptState, formData: FormData): Promise<PromptState> {
  requireDemo();
  const prompt = text(formData, "prompt", 500);
  const route = routePrompt(prompt);
  if (route.kind === "error") return { values: { prompt }, errors: { prompt: [route.message] } };
  redirect(route.href);
}
