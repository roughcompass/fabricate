"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DialogState } from "@/components/onboarding/form-dialog";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import type { PlacementDecisionKind } from "@/lib/db/schema";
import { statedActor } from "@/lib/onboarding/attribution";
import { declareReference, referencesOf, retireReference } from "@/lib/onboarding/external/references";
import { requestRefresh } from "@/lib/onboarding/external/refresh";
import { BlockedError } from "@/lib/onboarding/issues";
import { type AcceptedValues, StaleDecisionError, decidePlacement, placementReview } from "@/lib/onboarding/reviews";
import { errorsFrom, integer, text, texts } from "@/lib/web/form-data";
import { rememberActor } from "../actor";
import { lines, submittedValues } from "../form-values";
import { reviewHref } from "./load";

const DECISIONS = ["approve", "reject", "withdraw", "retire"] as const satisfies readonly PlacementDecisionKind[];

function assertPlacementId(publicId: string): void {
  if (!isPublicId(publicId, "plc")) throw new NotFoundError("Unknown placement");
}

/** Where a refused decision's issues go: the dialog's field when it has one, else its alert. */
function blocked(error: BlockedError): DialogState["errors"] {
  const errors: DialogState["errors"] = {};
  for (const issue of error.issues) {
    const field = issue.location.startsWith("defaults.") ? (issue.code === "placement.default_environment" ? "defaults" : `replacement.${issue.location.slice("defaults.".length)}`) : issue.location === "route" ? "route" : "base";
    (errors[field] ??= []).push(issue.message);
  }
  return errors;
}

/**
 * Records one decision about the placement's request of +revision+. A
 * decision made from a page someone else has since decided on is refused
 * with what was entered kept, and the page behind the dialog shows the
 * newer decision.
 */
export async function decidePlacementAction(placement: string, revision: number, decision: PlacementDecisionKind, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertPlacementId(placement);
  if (!DECISIONS.includes(decision)) throw new NotFoundError("Unknown decision");
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    const accepted: Partial<AcceptedValues> | undefined =
      decision === "approve"
        ? {
            route: text(formData, "route", 300),
            menuParent: text(formData, "menuParent", 80) || null,
            label: text(formData, "label", 150),
            order: integer(formData, "order") ?? -1,
            entitlements: { codes: lines(formData, "codes"), operator: text(formData, "operator", 10) === "all" ? "all" : "any" },
            defaults: texts(formData, "defaults", 60, 20),
          }
        : undefined;
    const replacementDefaults = Object.fromEntries([...formData.keys()].filter((key) => /^replacement\.[a-z][a-z0-9-]{0,31}$/.test(key)).map((key) => [key.slice("replacement.".length), text(formData, key, 40)]).filter(([, value]) => value));
    decidePlacement(getDb(), { placement, revision, expectedSequence: integer(formData, "expectedSequence") ?? -1, decision, reason: text(formData, "reason", 1_200), accepted, replacementDefaults, actor });
    await rememberActor(actor.name);
  } catch (error) {
    if (error instanceof StaleDecisionError) {
      revalidatePath(reviewHref(placement));
      return { values, errors: { base: [`${error.message}. The page now shows that decision; what you entered is kept here. Review it before deciding again.`] } };
    }
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    if (error instanceof BlockedError) return { values, errors: blocked(error) };
    if (error instanceof StaleRecordError || error instanceof TransitionError) {
      revalidatePath(reviewHref(placement));
      return { values, errors: { base: [error.message] } };
    }
    throw error;
  }
  redirect(`${reviewHref(placement)}?notice=${decision}`);
}

export async function refreshPlacementAction(placement: string): Promise<void> {
  assertPlacementId(placement);
  const db = getDb();
  const review = placementReview(db, placement);
  if (!review) throw new NotFoundError("Unknown placement");
  requestRefresh(db, { kind: "placement", id: review.placement.id, publicId: placement });
  redirect(`${reviewHref(placement)}?notice=refresh#current-state`);
}

export async function addPlacementReferenceAction(placement: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertPlacementId(placement);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    const db = getDb();
    const review = placementReview(db, placement);
    if (!review) throw new NotFoundError("Unknown placement");
    declareReference(db, { system: "studio", resourceType: "menu", externalId: text(formData, "externalId", 200), environment: text(formData, "environment", 60) || null, subject: { kind: "placement", id: review.placement.id }, source: "person", actor });
    await rememberActor(actor.name);
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    throw error;
  }
  redirect(`${reviewHref(placement)}?notice=reference#references`);
}

export async function removePlacementReferenceAction(placement: string, referencePublicId: string): Promise<void> {
  assertPlacementId(placement);
  const db = getDb();
  const review = placementReview(db, placement);
  if (!review) throw new NotFoundError("Unknown placement");
  const reference = referencesOf(db, { kind: "placement", id: review.placement.id }).find((item) => item.publicId === referencePublicId);
  if (reference && reference.source === "person") retireReference(db, reference);
  redirect(`${reviewHref(placement)}?notice=reference-removed#references`);
}
