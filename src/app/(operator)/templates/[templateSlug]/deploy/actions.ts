"use server";

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { templateBySlug } from "@/lib/demo/catalog";
import { type DeployInput, createApplication, validateDeployInput } from "@/lib/demo/deployments";
import { requireDemo } from "@/lib/demo/guard";
import { writableWorkspace } from "@/lib/demo/request";
import { DemoLimitError } from "@/lib/demo/workspaces";
import { errorsFrom, text } from "@/lib/web/form-data";
import type { DeployFormState } from "./deploy-form-state";

function readForm(formData: FormData): DeployInput {
  return {
    name: text(formData, "name", 200),
    environment: text(formData, "environment", 20),
    project: text(formData, "project", 40),
    repository: text(formData, "repository", 100),
  };
}

/** Creates the application and opens its page, where the simulated build plays. */
export async function createApplicationAction(templateSlug: string, _previous: DeployFormState, formData: FormData): Promise<DeployFormState> {
  requireDemo();
  const template = templateBySlug(templateSlug);
  if (!template) notFound();
  const form = readForm(formData);
  let publicId: string;
  try {
    const values = validateDeployInput(form);
    const workspace = await writableWorkspace();
    publicId = createApplication(getDb(), workspace.id, template, values).publicId;
  } catch (error) {
    if (error instanceof ValidationError) return { values: form, errors: errorsFrom(error) };
    if (error instanceof DemoLimitError) return { values: form, errors: { base: [error.message] } };
    throw error;
  }
  redirect(`/applications/${publicId}`);
}
