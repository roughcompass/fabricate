"use server";

import { redirect } from "next/navigation";
import { launchAssessment } from "@/lib/assessments/launcher";
import { ScopeResolutionError } from "@/lib/assessments/scope-resolver";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { SELECTION_MODES, type SelectionMode } from "@/lib/db/schema";
import * as records from "@/lib/initiatives/initiative-records";
import { errorsFrom, integer, text, texts } from "@/lib/web/form-data";
import type { InitiativeFormState, InitiativeFormValues, LaunchState } from "./form-state";

function readForm(formData: FormData): InitiativeFormValues {
  const mode = text(formData, "selectionMode", 20);
  return {
    name: text(formData, "name", 500),
    objective: text(formData, "objective", 4_000),
    selectionMode: (SELECTION_MODES as readonly string[]).includes(mode) ? (mode as SelectionMode) : ("" as SelectionMode),
    sourcePublicIds: texts(formData, "sourcePublicIds", 40),
    standardReleasePublicIds: texts(formData, "standardReleasePublicIds", 40),
  };
}

function assertInitiativeId(publicId: string): void {
  if (!isPublicId(publicId, "ini")) throw new NotFoundError("Unknown initiative");
}

export async function createInitiative(_previous: InitiativeFormState, formData: FormData): Promise<InitiativeFormState> {
  const values = readForm(formData);
  let publicId: string;
  try {
    publicId = records.createInitiative(getDb(), values).publicId;
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    throw error;
  }
  redirect(`/assessments/${publicId}?notice=created`);
}

export async function updateInitiative(publicId: string, previous: InitiativeFormState, formData: FormData): Promise<InitiativeFormState> {
  assertInitiativeId(publicId);
  const values = readForm(formData);
  const lockVersion = integer(formData, "lockVersion");
  try {
    if (lockVersion === null) throw new StaleRecordError("Missing lock version");
    records.updateInitiative(getDb(), publicId, lockVersion, values);
  } catch (error) {
    if (error instanceof ValidationError) return { ...previous, values, errors: errorsFrom(error) };
    if (error instanceof StaleRecordError) {
      return { ...previous, values, errors: { base: ["This initiative was changed by someone else. Reload the page to review the current values, then try again."] } };
    }
    throw error;
  }
  redirect(`/assessments/${publicId}?notice=updated`);
}

export async function deleteInitiative(formData: FormData): Promise<void> {
  const publicId = text(formData, "publicId", 40);
  assertInitiativeId(publicId);
  try {
    records.deleteInitiative(getDb(), publicId);
  } catch (error) {
    if (error instanceof ValidationError) redirect(`/assessments/${publicId}?notice=retained`);
    throw error;
  }
  redirect("/assessments?notice=deleted");
}

export async function startAssessment(initiativePublicId: string, _previous: LaunchState, formData: FormData): Promise<LaunchState> {
  assertInitiativeId(initiativePublicId);
  let location: string;
  try {
    const result = launchAssessment(getDb(), initiativePublicId, text(formData, "launchToken", 40));
    location = `/runs/${result.assessment.publicId}?notice=${result.duplicate ? "already-started" : "started"}`;
  } catch (error) {
    if (error instanceof ScopeResolutionError) return { problems: error.problems.map((problem) => problem.message) };
    throw error;
  }
  redirect(location);
}
