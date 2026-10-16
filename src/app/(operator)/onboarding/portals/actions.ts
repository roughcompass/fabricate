"use server";

import type { JsonObject } from "@repo-facts/contract";
import { redirect } from "next/navigation";
import type { DraftFormState } from "@/components/onboarding/draft-form";
import type { DialogState } from "@/components/onboarding/form-dialog";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { UNSTATED_ACTOR, statedActor } from "@/lib/onboarding/attribution";
import { declareReference, referencesOf, retireReference } from "@/lib/onboarding/external/references";
import { requestRefresh } from "@/lib/onboarding/external/refresh";
import { BlockedError } from "@/lib/onboarding/issues";
import { type PortalDraft, activatePortal, createPortal, getPortal, readPortalDraft, retirePortal, savePortalDraft, startPortalDraft, submitPortal } from "@/lib/onboarding/portals";
import { assignDefault } from "@/lib/onboarding/reviews";
import { StaleDraftError, draftOf } from "@/lib/onboarding/revisions";
import { errorsFrom, integer, text, texts } from "@/lib/web/form-data";
import { rememberPortal } from "@/lib/web/portal-cookie";
import { rememberActor, rememberedActor } from "../actor";
import { intentOf, rowIndices, submittedValues } from "../form-values";
import { PORTAL_STEPS, type PortalStep, portalHref, stepHref } from "./load";

function assertPortalId(publicId: string): void {
  if (!isPublicId(publicId, "ptl")) throw new NotFoundError("Unknown Portal");
}

const STALE_DRAFT = "Someone saved this Draft after you opened it. What you entered is below, and the Draft has their changes. Saving again replaces their changes with yours.";

/** A refused action's problems as a form's errors: field issues at their fields, the rest at the top. */
function refused(values: DialogState["values"], error: unknown): DialogState {
  if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
  if (error instanceof BlockedError) return { values, errors: { base: error.issues.map((issue) => issue.message) } };
  if (error instanceof StaleRecordError) return { values, errors: { base: [`${error.message}. Reload the page to see the change, then try again.`] } };
  if (error instanceof TransitionError) return { values, errors: { base: [error.message] } };
  throw error;
}

/**
 * Creates a Portal from the Create Portal form (portal-creation spec). The form
 * doesn't ask who's creating it: it's recorded, unverified, as the name the
 * operator last gave in Web Onboarding, or as "Not stated".
 */
export async function createPortalAction(_previous: DialogState, formData: FormData): Promise<DialogState> {
  const values = submittedValues(formData);
  let location: string;
  try {
    const actor = statedActor((await rememberedActor()) || UNSTATED_ACTOR);
    const { portal, adopted } = createPortal(
      getDb(),
      { platform: text(formData, "platform", 20), sealId: text(formData, "sealId", 100), name: text(formData, "name", 300), description: text(formData, "description", 1000), slug: text(formData, "slug", 100) },
      actor,
    );
    // A created Portal becomes the switcher's current one (portal-creation spec).
    await rememberPortal(portal.publicId);
    location = `${stepHref(portal.publicId, "identity")}?notice=${adopted ? "adopted" : "created"}`;
  } catch (error) {
    return refused(values, error);
  }
  redirect(location);
}

export async function startPortalDraftAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertPortalId(publicId);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    startPortalDraft(getDb(), publicId, actor);
    await rememberActor(actor.name);
  } catch (error) {
    return refused(values, error);
  }
  redirect(`${stepHref(publicId, "identity")}?notice=draft-started`);
}

/** Reads one step's fields into the Draft, leaving the other steps' values, and any history kept from the earlier format, as they are. */
function applyStep(draft: PortalDraft, step: PortalStep, formData: FormData): PortalDraft {
  const intent = intentOf(formData);
  switch (step) {
    case "identity":
      return { ...draft, ownerTeam: text(formData, "ownerTeam", 300), sealId: text(formData, "sealId", 100) };
    case "environments":
      return { ...draft, environments: [...new Set(texts(formData, "environments", 60, 20).map((key) => key.trim()).filter(Boolean))] };
    case "menu": {
      let menu = rowIndices(formData, "menu").map((index) => {
        const at = `menu.${index}`;
        return { key: text(formData, `${at}.key`, 80).trim(), label: text(formData, `${at}.label`, 150), parent: text(formData, `${at}.parent`, 80) || null, order: integer(formData, `${at}.order`) ?? 0 };
      });
      if (intent.kind === "add" && intent.list === "menu") menu = [...menu, { key: "", label: "", parent: null, order: menu.length + 1 }];
      if (intent.kind === "remove" && intent.list === "menu") menu = menu.filter((_, index) => index !== intent.index);
      return { ...draft, menu: menu.slice(0, 500) };
    }
    default:
      return draft;
  }
}

/**
 * Saves one step of the Portal's Draft. Adding or removing a row saves too,
 * so the form works without JavaScript. A save based on a Draft someone
 * changed since is refused, keeping what was entered.
 */
export async function savePortalStep(publicId: string, step: PortalStep, previous: DraftFormState, formData: FormData): Promise<DraftFormState> {
  assertPortalId(publicId);
  const values = submittedValues(formData);
  const db = getDb();
  const portal = getPortal(db, publicId);
  const draft = draftOf(db, "portal", portal.id);
  if (!draft) redirect(portalHref(publicId));
  const lockVersion = integer(formData, "lockVersion") ?? -1;
  const intent = intentOf(formData);
  let saved: number;
  try {
    saved = savePortalDraft(db, publicId, { lockVersion, document: applyStep(readPortalDraft(draft), step, formData) as unknown as JsonObject }).lockVersion;
  } catch (error) {
    if (error instanceof StaleDraftError) return { values, errors: { base: [STALE_DRAFT] }, lockVersion: error.current.lockVersion };
    if (error instanceof ValidationError) return { values, errors: { base: ["The form couldn't be read. Reload the page and try again."], ...errorsFrom(error) }, lockVersion: previous.lockVersion };
    throw error;
  }
  const next = PORTAL_STEPS[PORTAL_STEPS.findIndex((candidate) => candidate.id === step) + 1]?.id;
  // The saved version makes each save's address distinct, so the page always shows what was saved.
  redirect(intent.kind === "continue" && next ? stepHref(publicId, next) : `${stepHref(publicId, step)}?notice=saved&count=${saved}${intent.kind === "add" ? "#last-row" : ""}`);
}

export async function submitPortalAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertPortalId(publicId);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    const result = submitPortal(getDb(), publicId, { lockVersion: integer(formData, "lockVersion") ?? -1, actor });
    await rememberActor(actor.name);
    if (!result.submitted) return { values, errors: { base: [`${result.issues.filter((issue) => issue.severity === "blocking").length} blocking issues remain. Fix them at their steps, then submit again.`] } };
  } catch (error) {
    if (error instanceof StaleDraftError) return { values, errors: { base: ["Someone saved this Draft after you opened it. Review it again before submitting."] } };
    return refused(values, error);
  }
  redirect(`${portalHref(publicId)}?notice=submitted`);
}

export async function activatePortalAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertPortalId(publicId);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    activatePortal(getDb(), publicId, { revision: integer(formData, "revision") ?? -1, lockVersion: integer(formData, "lockVersion") ?? -1, actor });
    await rememberActor(actor.name);
  } catch (error) {
    return refused(values, error);
  }
  redirect(`${portalHref(publicId)}?notice=activated`);
}

export async function retirePortalAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertPortalId(publicId);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    retirePortal(getDb(), publicId, { lockVersion: integer(formData, "lockVersion") ?? -1, reason: text(formData, "reason", 1_200), actor });
    await rememberActor(actor.name);
  } catch (error) {
    return refused(values, error);
  }
  redirect(`${portalHref(publicId)}?notice=retired`);
}

export async function assignDefaultAction(publicId: string, environment: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertPortalId(publicId);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    assignDefault(getDb(), { portal: publicId, environment, placement: text(formData, "placement", 40) || null, expectedSequence: integer(formData, "sequence") ?? -1, actor });
    await rememberActor(actor.name);
  } catch (error) {
    return refused(values, error);
  }
  redirect(`${portalHref(publicId)}?notice=default#defaults`);
}

export async function refreshPortalAction(publicId: string): Promise<void> {
  assertPortalId(publicId);
  const db = getDb();
  const portal = getPortal(db, publicId);
  requestRefresh(db, { kind: "portal", id: portal.id, publicId });
  redirect(`${portalHref(publicId)}?notice=refresh#current-state`);
}

export async function addPortalReferenceAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertPortalId(publicId);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    const db = getDb();
    const portal = getPortal(db, publicId);
    const resourceType = text(formData, "resourceType", 20) === "environment" ? "environment" : "channel";
    declareReference(db, { system: "studio", resourceType, externalId: text(formData, "externalId", 200), environment: resourceType === "environment" ? text(formData, "environment", 40) : null, subject: { kind: "portal", id: portal.id }, source: "person", actor });
    await rememberActor(actor.name);
  } catch (error) {
    return refused(values, error);
  }
  redirect(`${portalHref(publicId)}?notice=reference#references`);
}

export async function removePortalReferenceAction(publicId: string, referencePublicId: string): Promise<void> {
  assertPortalId(publicId);
  const db = getDb();
  const portal = getPortal(db, publicId);
  const reference = referencesOf(db, { kind: "portal", id: portal.id }).find((item) => item.publicId === referencePublicId);
  if (reference) retireReference(db, reference);
  redirect(`${portalHref(publicId)}?notice=reference-removed#references`);
}
