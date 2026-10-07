"use server";

import type { JsonObject } from "@repo-facts/contract";
import { redirect } from "next/navigation";
import type { DraftFormState } from "@/components/onboarding/draft-form";
import type { DialogState } from "@/components/onboarding/form-dialog";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { RENDERING_MODES } from "@/lib/db/schema";
import { type ApplicationDraft, confirmRendering, createWebApplication, getApplication, readApplicationDraft, retireWebApplication, saveApplicationDraft, startApplicationDraft, submitApplication } from "@/lib/onboarding/applications";
import { statedActor } from "@/lib/onboarding/attribution";
import { declareReference, referencesOf, retireReference } from "@/lib/onboarding/external/references";
import { requestRefresh } from "@/lib/onboarding/external/refresh";
import { BlockedError } from "@/lib/onboarding/issues";
import { StaleDraftError, draftOf } from "@/lib/onboarding/revisions";
import { errorsFrom, integer, text, texts } from "@/lib/web/form-data";
import { rememberActor } from "../actor";
import { checked, intentOf, lines, rowIndices, submittedValues } from "../form-values";
import { APPLICATION_STEPS, type ApplicationStep, applicationHref, applicationStepHref } from "./load";

function assertApplicationId(publicId: string): void {
  if (!isPublicId(publicId, "wap") && !isPublicId(publicId, "sea")) throw new NotFoundError("Unknown Web Application");
}

const STALE_DRAFT = "Someone saved this Draft after you opened it. What you entered is below, and the Draft has their changes. Saving again replaces their changes with yours.";

function refused(values: DialogState["values"], error: unknown): DialogState {
  if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
  if (error instanceof BlockedError) return { values, errors: { base: error.issues.map((issue) => issue.message) } };
  if (error instanceof StaleRecordError) return { values, errors: { base: [`${error.message}. Reload the page to see the change, then try again.`] } };
  if (error instanceof TransitionError) return { values, errors: { base: [error.message] } };
  throw error;
}

export async function createApplicationAction(_previous: DialogState, formData: FormData): Promise<DialogState> {
  const values = submittedValues(formData);
  let location: string;
  try {
    const actor = statedActor(text(formData, "actor", 300));
    const { application } = createWebApplication(getDb(), { name: text(formData, "name", 300), ownerTeam: text(formData, "ownerTeam", 300), sealId: text(formData, "sealId", 100) }, actor);
    await rememberActor(actor.name);
    location = `${applicationStepHref(application.publicId, "identity")}?notice=created`;
  } catch (error) {
    return refused(values, error);
  }
  redirect(location);
}

export async function startApplicationDraftAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertApplicationId(publicId);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    startApplicationDraft(getDb(), publicId, actor);
    await rememberActor(actor.name);
  } catch (error) {
    return refused(values, error);
  }
  redirect(`${applicationStepHref(publicId, "identity")}?notice=draft-started`);
}

const nullable = (value: string) => value.trim() || null;

/** Applies one row edit, Add or Remove, to +rows+. */
function edited<T>(rows: T[], list: string, intent: ReturnType<typeof intentOf>, blank: () => T): T[] {
  if (intent.kind === "add" && intent.list === list) return [...rows, blank()];
  if (intent.kind === "remove" && intent.list === list) return rows.filter((_, index) => index !== intent.index);
  return rows;
}

function applyStep(draft: ApplicationDraft, step: ApplicationStep, formData: FormData): ApplicationDraft {
  const intent = intentOf(formData);
  switch (step) {
    case "identity":
      return { ...draft, name: text(formData, "name", 300), ownerTeam: nullable(text(formData, "ownerTeam", 300)), sealId: nullable(text(formData, "sealId", 100)) };
    case "launch": {
      const kind = text(formData, "launch.kind", 20);
      const mode = text(formData, "launch.mode", 40);
      const external = kind === "external";
      const chosen = (RENDERING_MODES as readonly string[]).includes(mode) ? (mode as (typeof RENDERING_MODES)[number]) : null;
      // Only the values the chosen target and mode use are kept, so switching never leaves the other kind's values behind.
      return {
        ...draft,
        launch: {
          kind: kind === "mfe" || external ? kind : null,
          microfrontend: kind === "mfe" ? nullable(text(formData, "launch.microfrontend", 40)) : null,
          mode: chosen,
          documentUrl: external && chosen === "iframe" ? nullable(text(formData, "launch.documentUrl", 2100)) : null,
          moduleUrl: external && chosen === "esm" ? nullable(text(formData, "launch.moduleUrl", 2100)) : null,
          exportedModule: chosen === "esm" ? nullable(text(formData, "launch.exportedModule", 300)) : null,
          manifestUrl: external && chosen === "module_federation_2" ? nullable(text(formData, "launch.manifestUrl", 2100)) : null,
          exposedModule: chosen === "module_federation_2" ? nullable(text(formData, "launch.exposedModule", 300)) : null,
          sandbox: chosen === "iframe" ? texts(formData, "launch.sandbox", 80, 20) : [],
          permissions: chosen === "iframe" ? texts(formData, "launch.permissions", 80, 20) : [],
          integrity: external && chosen === "esm" ? nullable(text(formData, "launch.integrity", 200)) : null,
        },
      };
    }
    case "composition": {
      // A shared MFE's button in the picker adds it as a child, ready for its mount.
      const picked = /^pick:(mfe_[a-z0-9]+)$/.exec(text(formData, "intent", 100))?.[1] ?? null;
      const children = edited(
        rowIndices(formData, "children").map((index): ApplicationDraft["children"][number] => {
          const mountKind = text(formData, `children.${index}.mountKind`, 10);
          return { microfrontend: text(formData, `children.${index}.microfrontend`, 40), mountKind: mountKind === "route" || mountKind === "slot" ? mountKind : null, mountKey: text(formData, `children.${index}.mountKey`, 300), required: checked(formData, `children.${index}.required`), module: nullable(text(formData, `children.${index}.module`, 300)) };
        }),
        "children",
        intent,
        (): ApplicationDraft["children"][number] => ({ microfrontend: "", mountKind: null, mountKey: "", required: true, module: null }),
      );
      if (picked) children.push({ microfrontend: picked, mountKind: null, mountKey: "", required: true, module: null });
      return { ...draft, children: children.slice(0, 50) };
    }
    case "placements": {
      // A claimed Portal's button requests a placement there, with the Portal filled in.
      const candidate = /^candidate:(ptl_[a-z0-9]+)$/.exec(text(formData, "intent", 100))?.[1] ?? null;
      const placements = edited(
        rowIndices(formData, "placements").map((index) => {
          const at = `placements.${index}`;
          const operator = text(formData, `${at}.operator`, 10);
          return {
            placement: nullable(text(formData, `${at}.placement`, 40)),
            portal: text(formData, `${at}.portal`, 40),
            menuParent: nullable(text(formData, `${at}.menuParent`, 80)),
            route: text(formData, `${at}.route`, 300),
            label: text(formData, `${at}.label`, 150),
            order: Math.min(Math.max(integer(formData, `${at}.order`) ?? 0, 0), 100_000),
            environments: texts(formData, `${at}.environments`, 60, 20),
            entitlements: { codes: lines(formData, `${at}.codes`), operator: operator === "all" ? ("all" as const) : ("any" as const) },
            defaultRequested: checked(formData, `${at}.defaultRequested`),
          };
        }),
        "placements",
        intent,
        () => ({ placement: null, portal: "", menuParent: null, route: "", label: draft.name, order: 0, environments: [], entitlements: { codes: [], operator: "any" as const }, defaultRequested: false }),
      );
      if (candidate) placements.push({ placement: null, portal: candidate, menuParent: null, route: "", label: draft.name, order: 0, environments: [], entitlements: { codes: [], operator: "any" }, defaultRequested: false });
      return { ...draft, placements: placements.slice(0, 50) };
    }
    default:
      return draft;
  }
}

/**
 * Saves one step of the Draft. On the launch step, Confirm settles the
 * rendering mode right after saving: an inferred proposal by its key, or
 * the values entered when there's no key.
 */
export async function saveApplicationStep(publicId: string, step: ApplicationStep, previous: DraftFormState, formData: FormData): Promise<DraftFormState> {
  assertApplicationId(publicId);
  const values = submittedValues(formData);
  const db = getDb();
  const application = getApplication(db, publicId);
  const draft = draftOf(db, "application", application.id);
  if (!draft) redirect(applicationHref(publicId));
  const intent = text(formData, "intent", 100);
  const confirming = step === "launch" && (intent === "confirm" || intent.startsWith("confirm:"));
  let saved: number;
  try {
    const actor = confirming ? statedActor(text(formData, "actor", 300)) : null;
    saved = saveApplicationDraft(db, publicId, { lockVersion: integer(formData, "lockVersion") ?? -1, document: applyStep(readApplicationDraft(draft), step, formData) as unknown as JsonObject }).lockVersion;
    if (actor) {
      saved = confirmRendering(db, publicId, { lockVersion: saved, candidate: intent.startsWith("confirm:") ? intent.slice("confirm:".length) : null, actor }).lockVersion;
      await rememberActor(actor.name);
    }
  } catch (error) {
    if (error instanceof StaleDraftError) return { values, errors: { base: [STALE_DRAFT] }, lockVersion: error.current.lockVersion };
    if (error instanceof StaleRecordError) return { values, errors: { base: [STALE_DRAFT] }, lockVersion: previous.lockVersion };
    if (error instanceof ValidationError) {
      const found = errorsFrom(error);
      // The values were saved before the confirmation was refused, so the form carries on from the saved version.
      const current = draftOf(db, "application", application.id)?.lockVersion ?? previous.lockVersion;
      return { values, errors: { base: [found.actor ? "Enter your name to confirm the rendering mode." : (found.candidate?.[0] ?? found["launch.mode"]?.[0] ?? "The form couldn't be read. Reload the page and try again.")], ...found }, lockVersion: current };
    }
    throw error;
  }
  const next = APPLICATION_STEPS[APPLICATION_STEPS.findIndex((candidate) => candidate.id === step) + 1]?.id;
  const kind = intentOf(formData).kind;
  if (confirming) redirect(`${applicationStepHref(publicId, step)}?notice=confirmed&count=${saved}#rendering`);
  const added = kind === "add" || intent.startsWith("candidate:") || intent.startsWith("pick:");
  redirect(kind === "continue" && next ? applicationStepHref(publicId, next) : `${applicationStepHref(publicId, step)}?notice=saved&count=${saved}${added ? "#last-row" : ""}`);
}

export async function submitApplicationAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertApplicationId(publicId);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    const result = submitApplication(getDb(), publicId, { lockVersion: integer(formData, "lockVersion") ?? -1, actor });
    await rememberActor(actor.name);
    if (!result.submitted) return { values, errors: { base: [`${result.issues.filter((issue) => issue.severity === "blocking").length} blocking issues remain. Fix them at their steps, then submit again.`] } };
  } catch (error) {
    if (error instanceof StaleDraftError) return { values, errors: { base: ["Someone saved this Draft after you opened it. Review it again before submitting."] } };
    return refused(values, error);
  }
  redirect(`${applicationHref(publicId)}?notice=submitted`);
}

export async function retireApplicationAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertApplicationId(publicId);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    retireWebApplication(getDb(), publicId, { lockVersion: integer(formData, "lockVersion") ?? -1, reason: text(formData, "reason", 1_200), actor });
    await rememberActor(actor.name);
  } catch (error) {
    return refused(values, error);
  }
  redirect(`${applicationHref(publicId)}?notice=retired`);
}

export async function refreshApplicationAction(publicId: string): Promise<void> {
  assertApplicationId(publicId);
  const db = getDb();
  const application = getApplication(db, publicId);
  requestRefresh(db, { kind: "application", id: application.id, publicId });
  redirect(`${applicationHref(publicId)}?notice=refresh#current-state`);
}

export async function addApplicationReferenceAction(publicId: string, _previous: DialogState, formData: FormData): Promise<DialogState> {
  assertApplicationId(publicId);
  const values = submittedValues(formData);
  try {
    const actor = statedActor(text(formData, "actor", 300));
    const db = getDb();
    const application = getApplication(db, publicId);
    declareReference(db, { system: "studio", resourceType: "module_group", externalId: text(formData, "externalId", 200), environment: text(formData, "environment", 60) || null, subject: { kind: "application", id: application.id }, source: "person", actor });
    await rememberActor(actor.name);
  } catch (error) {
    return refused(values, error);
  }
  redirect(`${applicationHref(publicId)}?notice=reference#references`);
}

export async function removeApplicationReferenceAction(publicId: string, referencePublicId: string): Promise<void> {
  assertApplicationId(publicId);
  const db = getDb();
  const application = getApplication(db, publicId);
  const reference = referencesOf(db, { kind: "application", id: application.id }).find((item) => item.publicId === referencePublicId);
  if (reference && reference.source === "person") retireReference(db, reference);
  redirect(`${applicationHref(publicId)}?notice=reference-removed#references`);
}
