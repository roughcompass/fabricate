"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DialogState } from "@/components/onboarding/form-dialog";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { type Actor, UNSTATED_ACTOR, statedActor } from "@/lib/onboarding/attribution";
import { type Move, addGroup, addItem, moveEntry, removeEntry, renameEntry, setDefault } from "@/lib/onboarding/navigation";
import { createPortal, editPortalDetails, promotePortal, returnToPrototype } from "@/lib/onboarding/portals";
import { rememberedActor } from "@/lib/web/actor-cookie";
import { errorsFrom, integer, submittedValues, text } from "@/lib/web/form-data";
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
  redirect(`${navigationHref(publicId)}?notice=${notice}${anchor}`);
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

export async function setDefaultAction(publicId: string, formData: FormData): Promise<void> {
  await buttonAction(publicId, (who) => setDefault(getDb(), publicId, { lockVersion: lockVersionOf(formData), entry: text(formData, "entry", 40) }, who), "default");
}

export async function removeEntryAction(publicId: string, formData: FormData): Promise<void> {
  await buttonAction(publicId, (who) => removeEntry(getDb(), publicId, { lockVersion: lockVersionOf(formData), entry: text(formData, "entry", 40) }, who), "removed", { "not-empty": /isn't empty/ });
}

/** Moves an entry up or down among its siblings: one form post per move, so it works without JavaScript. */
export async function moveEntryAction(publicId: string, direction: "up" | "down", formData: FormData): Promise<void> {
  await buttonAction(publicId, (who) => moveEntry(getDb(), publicId, { lockVersion: lockVersionOf(formData), entry: text(formData, "entry", 40), move: { direction: direction === "down" ? "down" : "up" } }, who), "moved", { edge: /already (first|last)/ });
}

/**
 * The menu's forms: add an item or a group, rename an entry, or move one
 * into another group. A refused change keeps what was entered with the
 * problem at its field; a stale one also shows the current menu.
 */
async function formAction(publicId: string, formData: FormData, work: (who: Actor) => void, done: string): Promise<DialogState> {
  assertPortalId(publicId);
  const values = submittedValues(formData);
  try {
    work(await actor());
  } catch (error) {
    if (error instanceof StaleRecordError) {
      refresh();
      return { values, errors: { base: [`${error.message}. The menu shows the current version; check it and make your change again.`] } };
    }
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    if (error instanceof TransitionError) return { values, errors: { base: [error.message] } };
    throw error;
  }
  backTo(publicId, done, "#menu");
}

export async function addItemAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  return formAction(publicId, formData, (who) => addItem(getDb(), publicId, { lockVersion: lockVersionOf(formData), label: text(formData, "label", 300), route: text(formData, "route", 300), application: text(formData, "application", 40), parent: text(formData, "parent", 40) || null }, who), "item-added");
}

export async function addGroupAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  return formAction(publicId, formData, (who) => addGroup(getDb(), publicId, { lockVersion: lockVersionOf(formData), label: text(formData, "label", 300), parent: text(formData, "parent", 40) || null }, who), "group-added");
}

export async function renameEntryAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  return formAction(publicId, formData, (who) => renameEntry(getDb(), publicId, { lockVersion: lockVersionOf(formData), entry: text(formData, "entry", 40), label: text(formData, "label", 300) }, who), "renamed");
}

export async function moveIntoAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  const move: Move = { into: text(formData, "into", 40) || null };
  return formAction(publicId, formData, (who) => moveEntry(getDb(), publicId, { lockVersion: lockVersionOf(formData), entry: text(formData, "entry", 40), move }, who), "moved");
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
