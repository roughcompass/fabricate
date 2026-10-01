"use server";

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { findRepository } from "@/lib/demo/catalog/repositories";
import { importRepository } from "@/lib/demo/deployments";
import { requireDemo } from "@/lib/demo/guard";
import { writableWorkspace } from "@/lib/demo/request";
import { DemoLimitError } from "@/lib/demo/workspaces";
import { errorsFrom, text } from "@/lib/web/form-data";
import type { ImportFormState } from "./form-state";

/** Imports the repository as a dev environment application and opens its page, where the simulated build plays. */
export async function importRepositoryAction(project: string, repositoryName: string, _previous: ImportFormState, formData: FormData): Promise<ImportFormState> {
  requireDemo();
  const repository = findRepository(project, repositoryName);
  if (!repository) notFound();
  const name = text(formData, "name", 200);
  let publicId: string;
  try {
    const workspace = await writableWorkspace();
    publicId = importRepository(getDb(), workspace.id, repository, name).publicId;
  } catch (error) {
    if (error instanceof ValidationError) {
      const errors = errorsFrom(error);
      // The repository is not a field on this form, so its refusal is the form's error.
      return { values: { name }, errors: { name: errors.name, base: errors.repository ?? errors.base } };
    }
    if (error instanceof DemoLimitError) return { values: { name }, errors: { base: [error.message] } };
    throw error;
  }
  redirect(`/applications/${publicId}`);
}
