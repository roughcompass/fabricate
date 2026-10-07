"use server";

import type { JsonObject } from "@repo-facts/contract";
import { redirect } from "next/navigation";
import type { DraftFormState } from "@/components/onboarding/draft-form";
import type { DialogState } from "@/components/onboarding/form-dialog";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { statedActor } from "@/lib/onboarding/attribution";
import { declareReference, referencesOf, retireReference } from "@/lib/onboarding/external/references";
import { requestRefresh } from "@/lib/onboarding/external/refresh";
import { BlockedError } from "@/lib/onboarding/issues";
import { getApplication } from "@/lib/onboarding/applications";
import { resolveLegacyIssues } from "@/lib/onboarding/formats";
import { type MicrofrontendDraft, getMicrofrontend, readMicrofrontendDraft, registerAssetFor, retireMicrofrontend, saveMicrofrontendDraft, startMicrofrontendDraft, submitMicrofrontend } from "@/lib/onboarding/microfrontends";
import { StaleDraftError, draftOf } from "@/lib/onboarding/revisions";
import { errorsFrom, integer, text } from "@/lib/web/form-data";
import { rememberActor } from "../actor";
import { applicationStepHref } from "../applications/load";
import { checked, intentOf, lines, submittedValues } from "../form-values";
import { MFE_STEPS, type MfeStep, mfeHref, mfeStepHref, withOrigin } from "./load";

function assertMfeId(publicId: string): void {
  if (!isPublicId(publicId, "mfe")) throw new NotFoundError("Unknown MFE");
}

/** The Application a page was opened from, when it's one; anything else is dropped. */
const originId = (from: string | null) => (from && (isPublicId(from, "wap") || isPublicId(from, "sea")) ? from : null);

const STALE_DRAFT = "Someone saved this Draft after you opened it. What you entered is below, and the Draft has their changes. Saving again replaces their changes with yours.";

function refused(values: DialogState["values"], error: unknown): DialogState {
  if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
  if (error instanceof BlockedError) return { values, errors: { base: error.issues.map((issue) => issue.message) } };
  if (error instanceof StaleRecordError) return { values, errors: { base: [`${error.message}. Reload the page to see the change, then try again.`] } };
  if (error instanceof TransitionError) return { values, errors: { base: [error.message] } };
  throw error;
}

/**
 * Registers an MFE from an Application's composition: one shared MFE
 * identity, owned by the Application's team unless another is named. Its
 * Draft opens with the way back to the same composition.
 */
export async function registerMicrofrontendAction(applicationPublicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  const values = submittedValues(formData);
  let location: string;
  try {
    const actor = statedActor(text(formData, "actor", 300));
    const db = getDb();
    const application = getApplication(db, applicationPublicId);
    const { microfrontend } = registerAssetFor(db, application, { name: text(formData, "name", 300), ownerTeam: text(formData, "ownerTeam", 300) || null, sealId: text(formData, "sealId", 100) || null }, actor);
    await rememberActor(actor.name);
    location = withOrigin(`${mfeStepHref(microfrontend.publicId, "source")}?notice=created`, application.publicId);
  } catch (error) {
    return refused(values, error);
  }
  redirect(location);
}

export async function startMicrofrontendDraftAction(publicId: string, from: string | null, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertMfeId(publicId);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    startMicrofrontendDraft(getDb(), publicId, actor);
    await rememberActor(actor.name);
  } catch (error) {
    return refused(values, error);
  }
  redirect(withOrigin(`${mfeStepHref(publicId, "identity")}?notice=draft-started`, originId(from)));
}

function applyStep(draft: MicrofrontendDraft, step: MfeStep, formData: FormData): MicrofrontendDraft {
  switch (step) {
    case "identity":
      return { ...draft, name: text(formData, "name", 300), ownerTeam: text(formData, "ownerTeam", 300), sealId: text(formData, "sealId", 100) };
    case "source":
      return { ...draft, repository: text(formData, "repository", 40) || null, workspacePath: text(formData, "workspacePath", 400) || null };
    case "cdaas": {
      const appId = text(formData, "cdaas.appId", 200).trim();
      const viewId = text(formData, "cdaas.viewId", 200).trim();
      return { ...draft, cdaas: appId || viewId ? { appId, viewId } : null };
    }
    case "rendering": {
      // Saving the step is the team's choice about how each mode loads it, so the migration issues it answers are resolved.
      const rendering = {
        iframe: checked(formData, "rendering.iframe.enabled") ? { entry: text(formData, "rendering.iframe.entry", 300).trim() || null } : null,
        esm: checked(formData, "rendering.esm.enabled") ? { exports: lines(formData, "rendering.esm.exports").slice(0, 50) } : null,
        module_federation_2: checked(formData, "rendering.module_federation_2.enabled") ? { exposes: lines(formData, "rendering.module_federation_2.exposes").slice(0, 50) } : null,
      };
      return resolveLegacyIssues({ ...draft, rendering }, "rendering");
    }
    default:
      return draft;
  }
}

export async function saveMicrofrontendStep(publicId: string, step: MfeStep, from: string | null, previous: DraftFormState, formData: FormData): Promise<DraftFormState> {
  assertMfeId(publicId);
  const values = submittedValues(formData);
  const db = getDb();
  const mfe = getMicrofrontend(db, publicId);
  const draft = draftOf(db, "microfrontend", mfe.id);
  if (!draft) redirect(mfeHref(publicId));
  const intent = intentOf(formData);
  let saved: number;
  try {
    saved = saveMicrofrontendDraft(db, publicId, { lockVersion: integer(formData, "lockVersion") ?? -1, document: applyStep(readMicrofrontendDraft(draft), step, formData) as unknown as JsonObject }).lockVersion;
  } catch (error) {
    if (error instanceof StaleDraftError) return { values, errors: { base: [STALE_DRAFT] }, lockVersion: error.current.lockVersion };
    if (error instanceof ValidationError) return { values, errors: { base: ["The form couldn't be read. Reload the page and try again."], ...errorsFrom(error) }, lockVersion: previous.lockVersion };
    throw error;
  }
  const next = MFE_STEPS[MFE_STEPS.findIndex((candidate) => candidate.id === step) + 1]?.id;
  redirect(withOrigin(intent.kind === "continue" && next ? mfeStepHref(publicId, next) : `${mfeStepHref(publicId, step)}?notice=saved&count=${saved}`, originId(from)));
}

/** Submits the MFE's Draft, returning to the composition it was opened from, when it was. */
export async function submitMicrofrontendAction(publicId: string, from: string | null, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertMfeId(publicId);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    const result = submitMicrofrontend(getDb(), publicId, { lockVersion: integer(formData, "lockVersion") ?? -1, actor });
    await rememberActor(actor.name);
    if (!result.submitted) return { values, errors: { base: [`${result.issues.filter((issue) => issue.severity === "blocking").length} blocking issues remain. Fix them at their steps, then submit again.`] } };
  } catch (error) {
    if (error instanceof StaleDraftError) return { values, errors: { base: ["Someone saved this Draft after you opened it. Review it again before submitting."] } };
    return refused(values, error);
  }
  const origin = originId(from);
  redirect(origin ? `${applicationStepHref(origin, "composition")}?notice=mfe-submitted` : `${mfeHref(publicId)}?notice=submitted`);
}

export async function retireMicrofrontendAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertMfeId(publicId);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    retireMicrofrontend(getDb(), publicId, { lockVersion: integer(formData, "lockVersion") ?? -1, reason: text(formData, "reason", 1_200), actor });
    await rememberActor(actor.name);
  } catch (error) {
    return refused(values, error);
  }
  redirect(`${mfeHref(publicId)}?notice=retired`);
}

export async function refreshMicrofrontendAction(publicId: string): Promise<void> {
  assertMfeId(publicId);
  const db = getDb();
  const mfe = getMicrofrontend(db, publicId);
  requestRefresh(db, { kind: "microfrontend", id: mfe.id, publicId });
  redirect(`${mfeHref(publicId)}?notice=refresh#current-state`);
}

export async function addMicrofrontendReferenceAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertMfeId(publicId);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    const db = getDb();
    const mfe = getMicrofrontend(db, publicId);
    declareReference(db, { system: "studio", resourceType: "module", externalId: text(formData, "externalId", 200), subject: { kind: "microfrontend", id: mfe.id }, source: "person", actor });
    await rememberActor(actor.name);
  } catch (error) {
    return refused(values, error);
  }
  redirect(`${mfeHref(publicId)}?notice=reference#references`);
}

export async function removeMicrofrontendReferenceAction(publicId: string, referencePublicId: string): Promise<void> {
  assertMfeId(publicId);
  const db = getDb();
  const mfe = getMicrofrontend(db, publicId);
  const reference = referencesOf(db, { kind: "microfrontend", id: mfe.id }).find((item) => item.publicId === referencePublicId);
  if (reference && reference.source === "person") retireReference(db, reference);
  redirect(`${mfeHref(publicId)}?notice=reference-removed#references`);
}
