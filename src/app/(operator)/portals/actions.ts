"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DialogState } from "@/components/onboarding/form-dialog";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { type Actor, UNSTATED_ACTOR, statedActor } from "@/lib/onboarding/attribution";
import { createPortal, editPortalDetails, promotePortal, returnToPrototype } from "@/lib/onboarding/portals";
import { rememberedActor } from "@/lib/web/actor-cookie";
import { errorsFrom, integer, submittedValues, text } from "@/lib/web/form-data";
import { rememberPortal } from "@/lib/web/portal-cookie";
import { currentPortal } from "@/lib/web/portal";
import { PORTALS_HREF, editorHref, portalHref } from "./paths";

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
 * Prototype, and opens its Portal page. The form doesn't ask who's
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
    location = `${portalHref(portal.publicId)}?notice=${adopted ? "adopted" : "created"}`;
  } catch (error) {
    return refused(values, error);
  }
  redirect(location);
}

function assertPortalId(publicId: string): void {
  if (!isPublicId(publicId, "ptl")) throw new NotFoundError("Unknown Portal");
}

const lockVersionOf = (formData: FormData) => integer(formData, "lockVersion") ?? -1;

/** Changes the sidebar's Portal switcher shows: the lifecycle badge, and the name. */
const SHOWN_IN_SWITCHER = new Set(["promoted", "returned", "edited"]);

/**
 * Back to the Portal's Navigation page with a notice code; the page builds
 * the message from the record. A change the switcher shows re-renders the
 * layout too, which otherwise keeps what it showed.
 */
function backTo(publicId: string, notice: string, anchor = ""): never {
  if (SHOWN_IN_SWITCHER.has(notice)) revalidatePath("/", "layout");
  redirect(`${portalHref(publicId)}?notice=${notice}${anchor}`);
}

/**
 * Runs one of the page's button actions: a move, a removal, a new default,
 * or a lifecycle change. A change based on an older version is refused and
 * the page shows the current menu with why (navigation spec, "Stale edits
 * are refused"); a refusal the record explains has its own notice.
 */
async function buttonAction(publicId: string, work: (who: Actor) => void, done: string, refusals: Record<string, RegExp> = {}): Promise<never> {
  assertPortalId(publicId);
  let notice = done;
  try {
    work(await actor());
  } catch (error) {
    if (error instanceof StaleRecordError) notice = "stale";
    else if (error instanceof TransitionError || error instanceof ValidationError) notice = Object.entries(refusals).find(([, pattern]) => pattern.test(error.message))?.[0] ?? "refused";
    else throw error;
  }
  backTo(publicId, notice, notice === done ? "#menu" : "");
}

export async function promotePortalAction(publicId: string, formData: FormData): Promise<void> {
  await buttonAction(publicId, (who) => promotePortal(getDb(), publicId, { lockVersion: lockVersionOf(formData) }, who), "promoted", { "no-default": /default route/ });
}

export async function returnToPrototypeAction(publicId: string, formData: FormData): Promise<void> {
  await buttonAction(publicId, (who) => returnToPrototype(getDb(), publicId, { lockVersion: lockVersionOf(formData) }, who), "returned");
}

/** Edit details: the SEAL ID, name, owning team, and description, in place. */
export async function editPortalAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertPortalId(publicId);
  const values = submittedValues(formData);
  try {
    editPortalDetails(getDb(), publicId, { sealId: text(formData, "sealId", 100), name: text(formData, "name", 300), ownerTeam: text(formData, "ownerTeam", 300), description: text(formData, "description", 1000), lockVersion: lockVersionOf(formData) }, await actor());
  } catch (error) {
    return refused(values, error);
  }
  backTo(publicId, "edited");
}

/**
 * Chooses a Portal from its card on the Portals page (runtime-configuration
 * spec, "The Portals page lists every Portal as a card"): it becomes the
 * switcher's current Portal, and its Experience Editor opens. A form post, so
 * it works without JavaScript.
 */
export async function openPortalAction(formData: FormData): Promise<void> {
  const portal = currentPortal(getDb(), text(formData, "portal", 40));
  if (!portal) redirect(PORTALS_HREF);
  await rememberPortal(portal.publicId);
  revalidatePath("/", "layout");
  redirect(editorHref(portal.publicId));
}
