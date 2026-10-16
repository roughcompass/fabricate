"use server";

import { redirect } from "next/navigation";
import type { DialogState } from "@/components/onboarding/form-dialog";
import { getDb } from "@/lib/db/client";
import { StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { UNSTATED_ACTOR, statedActor } from "@/lib/onboarding/attribution";
import { createPortal } from "@/lib/onboarding/portals";
import { rememberedActor } from "@/lib/web/actor-cookie";
import { errorsFrom, submittedValues, text } from "@/lib/web/form-data";
import { rememberPortal } from "@/lib/web/portal-cookie";
import { navigationHref } from "./paths";

/** Who a change is recorded as: the remembered name, or "Not stated", unverified (reviews spec). */
async function actor() {
  return statedActor((await rememberedActor()) || UNSTATED_ACTOR);
}

/** A refused action's problems as a form's errors: field issues at their fields, the rest at the top. */
function refused(values: DialogState["values"], error: unknown): DialogState {
  if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
  if (error instanceof StaleRecordError) return { values, errors: { base: [`${error.message}. Reload the page to see the change, then try again.`] } };
  if (error instanceof TransitionError) return { values, errors: { base: [error.message] } };
  throw error;
}

/**
 * Creates a Portal from the Create Portal form (portal-creation spec), as a
 * Prototype, and opens its Navigation page. The form doesn't ask who's
 * creating it: it's recorded, unverified, as the remembered name or as "Not
 * stated".
 */
export async function createPortalAction(_previous: DialogState, formData: FormData): Promise<DialogState> {
  const values = submittedValues(formData);
  let location: string;
  try {
    const { portal, adopted } = createPortal(
      getDb(),
      { platform: text(formData, "platform", 20), sealId: text(formData, "sealId", 100), name: text(formData, "name", 300), ownerTeam: text(formData, "ownerTeam", 300), description: text(formData, "description", 1000), slug: text(formData, "slug", 100) },
      await actor(),
    );
    // A created Portal becomes the switcher's current one (portal-creation spec).
    await rememberPortal(portal.publicId);
    location = `${navigationHref(portal.publicId)}?notice=${adopted ? "adopted" : "created"}`;
  } catch (error) {
    return refused(values, error);
  }
  redirect(location);
}
