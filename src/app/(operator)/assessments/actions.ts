"use server";

import { redirect } from "next/navigation";
import { launchRun } from "@/lib/runs/launcher";
import { ScopeResolutionError } from "@/lib/runs/scope-resolver";
import { getDb } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { requirePublicId } from "@/lib/db/ids";
import type { SelectionMode } from "@/lib/db/schema";
import * as records from "@/lib/initiatives/initiative-records";
import { lockVersion, submitForm } from "@/lib/web/actions";
import { text, texts } from "@/lib/web/form-data";
import type { InitiativeFormState, InitiativeFormValues, LaunchState } from "./form-state";
import { withQuery } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";

function readForm(formData: FormData): InitiativeFormValues {
  const mode = text(formData, "selectionMode", 20);
  return {
    name: text(formData, "name", 500),
    objective: text(formData, "objective", 4_000),
    selectionMode: (records.SELECTION_MODES as readonly string[]).includes(mode) ? (mode as SelectionMode) : ("" as SelectionMode),
    sourcePublicIds: texts(formData, "sourcePublicIds", 40),
    standardReleasePublicIds: texts(formData, "standardReleasePublicIds", 40),
  };
}

const assessmentId = (publicId: string) => requirePublicId(publicId, "ini", "initiative");

export async function createInitiative(_previous: InitiativeFormState, formData: FormData): Promise<InitiativeFormState> {
  const values = readForm(formData);
  return submitForm(values, () => routes.assessment(records.createInitiative(getDb(), values).publicId, { notice: "created" }));
}

export async function updateInitiative(publicId: string, _previous: InitiativeFormState, formData: FormData): Promise<InitiativeFormState> {
  assessmentId(publicId);
  const values = readForm(formData);
  return submitForm(
    values,
    () => {
      records.updateInitiative(getDb(), publicId, lockVersion(formData), values);
      return routes.assessment(publicId, { notice: "updated" });
    },
    "This initiative was changed by someone else. Reload the page to review the current values, then try again.",
  );
}

export async function deleteInitiative(formData: FormData): Promise<void> {
  const publicId = assessmentId(text(formData, "publicId", 40));
  try {
    records.deleteInitiative(getDb(), publicId);
  } catch (error) {
    if (error instanceof ValidationError) redirect(routes.assessment(publicId, { notice: "retained" }));
    throw error;
  }
  redirect(withQuery(routes.assessments, { notice: "deleted" }));
}

export async function startRun(initiativePublicId: string, _previous: LaunchState, formData: FormData): Promise<LaunchState> {
  assessmentId(initiativePublicId);
  let location: string;
  try {
    const result = launchRun(getDb(), initiativePublicId, text(formData, "launchToken", 40));
    location = routes.run(result.run.publicId, { notice: result.duplicate ? "already-started" : "started" });
  } catch (error) {
    if (error instanceof ScopeResolutionError) return { problems: error.problems.map((problem) => problem.message) };
    throw error;
  }
  redirect(location);
}
