import type { JsonObject } from "@repo-facts/contract";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { type ApplicationDraft, applicationDraftSchema, confirmRendering, createWebApplication, getApplication, inferRendering, saveApplicationDraft, submitApplication } from "@/lib/onboarding/applications";
import { type Actor, statedActor } from "@/lib/onboarding/attribution";
import type { Rendering } from "@/lib/onboarding/formats";
import { type ReadResult, recordRead } from "@/lib/onboarding/external/evidence";
import { type ReferenceSubject, declareReference, referenceOf } from "@/lib/onboarding/external/references";
import { BlockedError } from "@/lib/onboarding/issues";
import { type Microfrontend, createMicrofrontend, getMicrofrontend, microfrontendDraftSchema, refreshMicrofrontendReadiness, saveMicrofrontendDraft, submitMicrofrontend } from "@/lib/onboarding/microfrontends";
import { type Portal, type PortalDraft, type PortalInput, activatePortal, createPortal, getPortal, portalDraftSchema, savePortalDraft, submitPortal } from "@/lib/onboarding/portals";
import { type AcceptedValues, decidePlacement, placementReview } from "@/lib/onboarding/reviews";
import type { SubmitResult } from "@/lib/onboarding/revisions";
import type { PlacementDecisionKind } from "@/lib/db/schema";

/*
 * Onboarding builders for tests. Every record is made through the same
 * operations the interface uses, so a fixture can't hold a value the
 * product would refuse: a builder throws whatever the operation throws, and
 * a submission blocked by validation fails with its issues.
 */

export const ana: Actor = statedActor("ana@example.com");
export const cy: Actor = statedActor("cy@example.com");

/** A Module Federation 2 entry MFE: one exposed module. */
export const MFE_RENDERING: Rendering = { iframe: null, esm: null, module_federation_2: { exposes: ["./App"] } };

/** A child MFE: one module, loadable as ESM or through Module Federation 2. */
export const CHILD_RENDERING: Rendering = { iframe: null, esm: { exports: ["./Widget"] }, module_federation_2: { exposes: ["./Widget"] } };

/** Fails a builder whose submission validation refused, with every issue. */
function submitted(result: SubmitResult, what: string): SubmitResult & { submitted: true } {
  if (!result.submitted) throw new BlockedError(`${what} wasn't submitted`, result.issues);
  return result;
}

/** What creating the Portal +name+ submits: a Web Portal with SEAL ID 88001, a description, and the slug its name derives. */
export function portalInput(name: string, overrides: Partial<PortalInput> = {}): PortalInput {
  return { name, sealId: "88001", platform: "web", description: `The ${name} Portal`, ...overrides };
}

/** A Portal Draft enabling UAT and PROD from the fallback catalog, with one menu group. */
export function portalDraft(overrides: Partial<PortalDraft> = {}): PortalDraft {
  return portalDraftSchema.parse({
    ownerTeam: "Access Platform",
    sealId: "88001",
    environments: ["uat", "prod"],
    menu: [{ key: "payments", label: "Payments", parent: null, order: 1 }],
    ...overrides,
  });
}

/** A Portal onboarded and submitted, so it's Ready. */
export function onboardPortal(db: Db, name: string, overrides: Partial<PortalDraft> = {}, actor = ana): Portal {
  const { portal, draft } = createPortal(db, portalInput(name, { ownerTeam: overrides.ownerTeam ?? "Access Platform", sealId: overrides.sealId ?? "88001" }), actor);
  const saved = savePortalDraft(db, portal.publicId, { lockVersion: draft.lockVersion, document: portalDraft(overrides) });
  submitted(submitPortal(db, portal.publicId, { lockVersion: saved.lockVersion, actor }), `Portal ${name}`);
  return getPortal(db, portal.publicId);
}

/** Activates a Portal's latest submitted revision. */
export function activate(db: Db, portal: Portal, revision = 1, actor = cy): Portal {
  const current = getPortal(db, portal.publicId);
  return activatePortal(db, current.publicId, { revision, lockVersion: current.lockVersion, actor });
}

export interface MfeOptions {
  repository: RepositorySource;
  workspacePath?: string | null;
  cdaas?: { appId: string; viewId: string } | null;
  rendering?: Rendering;
  sealId?: string | null;
  ownerTeam?: string;
  /** Record a CDaaS read that confirms the view. */
  confirmed?: boolean;
}

/** An MFE registered and submitted, with its CDaaS view confirmed unless asked otherwise. */
export function registerMfe(db: Db, name: string, options: MfeOptions, actor = ana): Microfrontend {
  const { microfrontend, draft } = createMicrofrontend(db, { name, ownerTeam: options.ownerTeam ?? "Payee", sealId: options.sealId ?? "88001" }, actor);
  const cdaas = options.cdaas === undefined ? { appId: "payee", viewId: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") } : options.cdaas;
  const document = microfrontendDraftSchema.parse({ name, ownerTeam: options.ownerTeam ?? "Payee", sealId: options.sealId ?? "88001", repository: options.repository.publicId, workspacePath: options.workspacePath ?? null, cdaas, rendering: options.rendering ?? MFE_RENDERING });
  const saved = saveMicrofrontendDraft(db, microfrontend.publicId, { lockVersion: draft.lockVersion, document });
  submitted(submitMicrofrontend(db, microfrontend.publicId, { lockVersion: saved.lockVersion, actor }), `MFE ${name}`);
  if (cdaas && options.confirmed !== false) observeCdaas(db, getMicrofrontend(db, microfrontend.publicId), { outcome: "found", projection: cdaasView(cdaas.appId, cdaas.viewId) });
  return getMicrofrontend(db, microfrontend.publicId);
}

export function cdaasView(appId: string, viewId: string, versions = 1) {
  return {
    appId,
    viewId,
    versions: Array.from({ length: versions }, (_, index) => ({ name: `1.${index}.0`, live: index === versions - 1, gitCommitHash: `abc${index}`, branch: "main", buildNumber: String(100 + index), repositoryUrl: "https://git.example.com/pay/payee", lastModified: "2026-10-03T08:00:00Z" })),
  };
}

/** Records a CDaaS read of the MFE's declared view, then checks its readiness again. */
export function observeCdaas(db: Db, mfe: Microfrontend, result: ReadResult, readAt = new Date()): Microfrontend {
  const reference = referenceOf(db, { kind: "microfrontend", id: mfe.id }, "cdaas", "application_view");
  if (!reference) throw new Error(`${mfe.name} declares no CDaaS view`);
  recordRead(db, reference, result, { readAt });
  return refreshMicrofrontendReadiness(db, getMicrofrontend(db, mfe.publicId), undefined, readAt);
}

/** Maps a record to a Studio resource and records a read of it. */
export function observeStudio(db: Db, subject: ReferenceSubject, resourceType: "channel" | "module_group" | "module" | "menu", externalId: string, result: ReadResult, environment: string | null = null, readAt = new Date()) {
  const reference = referenceOf(db, subject, "studio", resourceType, environment) ?? declareReference(db, { system: "studio", resourceType, externalId, environment, subject, source: "person", actor: ana });
  return recordRead(db, reference, result, { readAt });
}

export type ApplicationSpec = Omit<Partial<ApplicationDraft>, "launch"> & { launch?: Partial<ApplicationDraft["launch"]> };

/** A Draft Application document with sensible defaults. */
export function applicationDraft(spec: ApplicationSpec): ApplicationDraft {
  return applicationDraftSchema.parse({ ownerTeam: "Payments", sealId: "88001", ...spec, launch: { ...spec.launch } });
}

/**
 * A Web Application through its first Draft: saved, its rendering mode
 * confirmed (the agreed inference, or the values given), and submitted.
 */
export function onboardApplication(db: Db, name: string, spec: ApplicationSpec, options: { candidate?: "agreed" | null; actor?: Actor; submit?: boolean } = {}) {
  const actor = options.actor ?? ana;
  const { application, draft } = createWebApplication(db, { name, ownerTeam: spec.ownerTeam ?? "Payments", sealId: spec.sealId === undefined ? "88001" : spec.sealId }, actor);
  let revision = saveApplicationDraft(db, application.publicId, { lockVersion: draft.lockVersion, document: applicationDraft({ name, ...spec }) });
  const inference = inferRendering(db, applicationDraft({ name, ...spec }).launch);
  const candidate = options.candidate === "agreed" && inference.agreed ? (inference.candidates.find((item) => item.module !== null) ?? inference.candidates[0]!).key : null;
  revision = confirmRendering(db, application.publicId, { lockVersion: revision.lockVersion, candidate, actor });
  if (options.submit === false) return { application: getApplication(db, application.publicId), revision, result: null };
  const result = submitted(submitApplication(db, application.publicId, { lockVersion: revision.lockVersion, actor }), `Application ${name}`);
  return { application: getApplication(db, application.publicId), revision: result.revision, result };
}

/** Decides a placement's latest request, as the Portal owner or Application team would. */
export function decide(db: Db, placement: string, decision: PlacementDecisionKind, extra: { reason?: string; accepted?: Partial<AcceptedValues>; replacementDefaults?: Record<string, string>; actor?: Actor } = {}) {
  const review = placementReview(db, placement)!;
  const revision = decision === "retire" || (decision === "withdraw" && review.state !== "pending" && review.activeRequest) ? (review.activeRequest?.revision ?? review.revision) : review.revision;
  const sequence = revision === review.revision ? review.sequence : review.activeRequest!.decision.sequence + 1;
  return decidePlacement(db, { placement, revision, expectedSequence: sequence, decision, reason: extra.reason ?? (decision === "reject" || decision === "retire" ? "Not this quarter" : null), accepted: extra.accepted, replacementDefaults: extra.replacementDefaults, actor: extra.actor ?? cy });
}

/** The placement public IDs an Application's latest submitted revision requests, in request order. */
export function placementsOf(db: Db, application: string): string[] {
  return db.$client
    .prepare(
      "select p.public_id as id from placement_requests r join application_placements p on p.id = r.placement_id join applications a on a.id = p.application_id where r.application_revision_id = a.active_revision_id and a.public_id = ? order by r.id",
    )
    .all(application)
    .map((row) => (row as { id: string }).id);
}

export type { JsonObject };
