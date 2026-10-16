"use server";

import { redirect } from "next/navigation";
import type { DialogState } from "@/components/onboarding/form-dialog";
import { ApplicationValidationError, applicationHref, editApplicationDetails } from "@/lib/applications/applications";
import { launchApplicationAssessment } from "@/lib/applications/assessment";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, TransitionError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { UNSTATED_ACTOR, statedActor } from "@/lib/onboarding/attribution";
import { rememberedActor } from "@/lib/web/actor-cookie";
import { errorsFrom, integer, submittedValues, text } from "@/lib/web/form-data";

function assertApplicationId(publicId: string): void {
  if (!isPublicId(publicId, "wap") && !isPublicId(publicId, "sea")) throw new NotFoundError("Unknown Application");
}

/** Who a change is recorded as: the remembered name, or "Not stated", unverified (reviews spec). */
async function actor() {
  return statedActor((await rememberedActor()) || UNSTATED_ACTOR);
}

/**
 * Re-runs the Application's DE Web assessment from its dashboard
 * (rendering-assessment spec, "An application can be re-assessed"). A launch
 * that can't start is recorded, and the dashboard says so.
 */
export async function rerunAssessmentAction(publicId: string): Promise<void> {
  assertApplicationId(publicId);
  let notice: string;
  try {
    notice = launchApplicationAssessment(getDb(), publicId).started ? "rerun" : "couldnt-start";
  } catch (error) {
    if (!(error instanceof TransitionError)) throw error;
    notice = "already-running";
  }
  redirect(`${applicationHref(publicId)}?notice=${notice}`);
}

/**
 * Saves Edit details: the name, SEAL ID, and description. A save based on
 * an older version is refused, keeping what was entered (reviews spec,
 * "Stale edits are refused rather than overwritten").
 */
export async function editApplicationAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertApplicationId(publicId);
  const values = submittedValues(formData);
  try {
    editApplicationDetails(getDb(), publicId, { name: text(formData, "name", 300), sealId: text(formData, "sealId", 100), description: text(formData, "description", 1000), lockVersion: integer(formData, "lockVersion") ?? -1 }, await actor());
  } catch (error) {
    if (error instanceof ApplicationValidationError) return { values, errors: errorsFrom(error) };
    if (error instanceof StaleRecordError) return { values, errors: { base: [`${error.message}. What you entered is below; reload the page to see the change, then save again.`] } };
    throw error;
  }
  redirect(`${applicationHref(publicId)}?notice=edited`);
}
