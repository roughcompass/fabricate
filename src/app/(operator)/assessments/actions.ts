"use server";

import { redirect } from "next/navigation";
import { launchRun } from "@/lib/runs/launcher";
import { ScopeResolutionError } from "@/lib/runs/scope-resolver";
import { getDb } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { requirePublicId } from "@/lib/db/ids";
import type { SelectionMode } from "@/lib/db/schema";
import * as records from "@/lib/assessments/assessment-records";
import { lockVersion, submitForm } from "@/lib/web/actions";
import { text, texts } from "@/lib/web/form-data";
import type { AssessmentFormState, AssessmentFormValues, LaunchState } from "./form-state";
import { withQuery } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";

function readForm(formData: FormData): AssessmentFormValues {
  const mode = text(formData, "selectionMode", 20);
  return {
    name: text(formData, "name", 500),
    objective: text(formData, "objective", 4_000),
    selectionMode: (records.SELECTION_MODES as readonly string[]).includes(mode) ? (mode as SelectionMode) : ("" as SelectionMode),
    repositoryPublicIds: texts(formData, "sourcePublicIds", 40),
    standardReleasePublicIds: texts(formData, "standardReleasePublicIds", 40),
  };
}

const requireAssessmentId = (publicId: string) => requirePublicId(publicId, "ini", "Assessment");

export async function createAssessment(_previous: AssessmentFormState, formData: FormData): Promise<AssessmentFormState> {
  const values = readForm(formData);
  return submitForm(values, () => routes.assessment(records.createAssessment(getDb(), values).publicId, { notice: "created" }));
}

export async function updateAssessment(publicId: string, _previous: AssessmentFormState, formData: FormData): Promise<AssessmentFormState> {
  requireAssessmentId(publicId);
  const values = readForm(formData);
  return submitForm(
    values,
    () => {
      records.updateAssessment(getDb(), publicId, lockVersion(formData), values);
      return routes.assessment(publicId, { notice: "updated" });
    },
    "This Assessment was changed by someone else. Reload the page to review the current values, then try again.",
  );
}

export async function deleteAssessment(formData: FormData): Promise<void> {
  const publicId = requireAssessmentId(text(formData, "publicId", 40));
  try {
    records.deleteAssessment(getDb(), publicId);
  } catch (error) {
    if (error instanceof ValidationError) redirect(routes.assessment(publicId, { notice: "retained" }));
    throw error;
  }
  redirect(withQuery(routes.assessments, { notice: "deleted" }));
}

export async function startRun(assessmentPublicId: string, _previous: LaunchState, formData: FormData): Promise<LaunchState> {
  requireAssessmentId(assessmentPublicId);
  let location: string;
  try {
    const result = launchRun(getDb(), assessmentPublicId, text(formData, "launchToken", 40));
    location = routes.run(result.run.publicId, { notice: result.duplicate ? "already-started" : "started" });
  } catch (error) {
    if (error instanceof ScopeResolutionError) return { problems: error.problems.map((problem) => problem.message) };
    throw error;
  }
  redirect(location);
}
