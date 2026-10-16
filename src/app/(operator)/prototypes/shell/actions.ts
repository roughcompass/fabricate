"use server";

import { redirect } from "next/navigation";
import { ValidationError } from "@/lib/db/errors";
import { requirePrototypes } from "@/lib/prototypes/guard";
import { prototypesRequest } from "@/lib/prototypes/request";
import { type ShellFormValues, parseShell, saveShell } from "@/lib/prototypes/shell";
import { DEFAULT_SHELL } from "@/lib/prototypes/seed/defaults";
import { errorsFrom, text } from "@/lib/web/form-data";
import type { FormState } from "@/components/ui/form";

export type ShellFormState = FormState<ShellFormValues>;

/** Saves the Page shell form (page-shell spec, "The shell's contents are workspace data"). */
export async function saveShellAction(_previous: ShellFormState, formData: FormData): Promise<ShellFormState> {
  requirePrototypes();
  const values: ShellFormValues = { appName: text(formData, "appName", 400), nav: text(formData, "nav", 4_000), footerText: text(formData, "footerText", 1_000), footerLinks: text(formData, "footerLinks", 2_000) };
  let shell;
  try {
    shell = parseShell(values);
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    throw error;
  }
  const { db, workspace } = await prototypesRequest();
  await saveShell(db, workspace.id, shell);
  redirect("/prototypes/shell?notice=saved");
}

/** Puts back the default shell for the fictional corporate banking portal. */
export async function restoreShellAction(): Promise<void> {
  requirePrototypes();
  const { db, workspace } = await prototypesRequest();
  await saveShell(db, workspace.id, DEFAULT_SHELL);
  redirect("/prototypes/shell?notice=restored");
}
