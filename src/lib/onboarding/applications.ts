import { type JsonObject, compareCodeUnits, dump, sha256 } from "@repo-facts/contract";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import {
  type EnvironmentCatalogSource,
  type LifecycleState,
  type RenderingConfirmation,
  type RenderingMode,
  applicationComponents,
  applicationEnvironments,
  applicationLaunchTargets,
  applicationPlacements,
  applicationRevisions,
  applications,
  microfrontendRevisions,
  microfrontends,
  onboardingEvents,
  placementRequestEnvironments,
  placementRequests,
  placementRoutes,
  portalEnvironments,
  portalMenuGroups,
  portals,
  renderingInferenceCandidates,
} from "@/lib/db/schema";
import { applicationOwnership } from "@/lib/ownership/read";
import { type Application, SEAL_ID, findApplication } from "@/lib/ownership/records";
import { type Actor, SYSTEM_ACTOR, recordEvent } from "./attribution";
import { contractLabel } from "./contracts";
import { type Entitlements, RENDERING_MODE_LABELS, canonicalize, entitlementsSchema, externalLaunchSchema, issuesOf, mfeLaunchSchema, studioModuleProjection } from "./documents";
import { type EnvironmentCatalog, environmentCatalog, environmentLabel, inCatalogOrder } from "./environments";
import { evidenceOf } from "./external/evidence";
import { referenceOf, retireReferencesOf } from "./external/references";
import { type ApplicationDraft, type LaunchDraft, type Rendering, applicationDraftSchema, canonicalDocument, draftOfDocument, launchDraftSchema, modulesFor, renderingOfRevision, supportedModes } from "./formats";
import { BlockedError, IssueList, type ValidationIssue } from "./issues";
import { type Microfrontend, findMicrofrontend, microfrontendReadiness } from "./microfrontends";
import { MENU_KEY, governingRevision } from "./portals";
import { type Revision, type SubmitResult, draftOf, latestSubmitted, revisionById, saveDraft, startDraft, submitDraft } from "./revisions";
import { normalizeRoute, ROUTE_PROBLEMS } from "./routes";

/*
 * Web Applications (applications spec). An Application is the code-backed
 * experience a Portal route loads. Each revision launches exactly one
 * target, a registered MFE or an externally hosted endpoint, through one
 * rendering mode; the target alone or with child MFEs it composes at
 * runtime. A rendering mode may be inferred only from attributable
 * evidence, and is used only once the team confirms or overrides it.
 * Placements in Portals are requested here, each naming the target
 * Portal's environments it appears in and the entitlements a visitor
 * needs, and reviewed by each Portal's owner. Nothing here declares Portal
 * capabilities or host contracts. An Application is Ready when its current
 * revision launches a confirmed target whose MFEs reconciliation confirms,
 * and at least one placement is approved.
 */

export const MOUNT_KEY = /^[a-z][a-z0-9-]{0,63}$/;

export { applicationDraftSchema, launchDraftSchema, type ApplicationDraft, type LaunchDraft };

/** A revision's Draft as v2 reads it: a v1 Draft is converted, its removed values kept as history. */
export function readApplicationDraft(revision: Pick<Revision, "number" | "formatVersion" | "document">): ApplicationDraft {
  return draftOfDocument("application", revision);
}

export function getApplication(db: Executor, publicId: string): Application {
  const application = findApplication(db, publicId);
  if (!application) throw new NotFoundError(`Web Application ${publicId} doesn't exist`);
  return application;
}

/** How an Application reads: its name, or for one named only by a claim, its SEAL ID. */
export function applicationName(application: Pick<Application, "name" | "sealId">): string {
  return application.name ?? application.sealId ?? "Unnamed application";
}

// ---------------------------------------------------------------------------
// Creating and editing

export interface ApplicationInput {
  name: string;
  ownerTeam?: string | null;
  sealId?: string | null;
}

/** Registers a Web Application and opens its first Draft. Its SEAL ID may be one other records carry. */
export function createWebApplication(db: Executor, input: ApplicationInput, actor: Actor): { application: Application; draft: Revision } {
  return immediate(db, (tx) => {
    const issues: { field: string; message: string }[] = [];
    const name = input.name.trim().replace(/\s+/g, " ");
    if (!name) issues.push({ field: "name", message: "Enter the Application's name" });
    else if (name.length > 200) issues.push({ field: "name", message: "Use 200 characters or fewer" });
    const sealId = input.sealId?.trim() || null;
    if (sealId && !SEAL_ID.test(sealId)) issues.push({ field: "sealId", message: "Enter a SEAL ID of letters, digits, dots, dashes, or underscores" });
    const ownerTeam = input.ownerTeam?.trim().replace(/\s+/g, " ") || null;
    if (ownerTeam && ownerTeam.length > 200) issues.push({ field: "ownerTeam", message: "Use 200 characters or fewer" });
    if (issues.length) throw new ValidationError(issues);
    const application = tx.insert(applications).values({ publicId: generatePublicId("wap"), name, sealId, ownerTeam, createdAt: new Date() }).returning().get();
    recordEvent(tx, "application", application.id, { event: "created", actor, to: "draft" });
    const draft = startDraft(tx, "application", application.id, actor, applicationDraftSchema.parse({ name, ownerTeam, sealId }) as unknown as JsonObject);
    return { application: findApplication(tx, application.publicId)!, draft };
  });
}

/** Opens the Application's Draft, starting one from its latest submitted revision, or from its claimed name for one never onboarded. */
export function startApplicationDraft(db: Executor, publicId: string, actor: Actor): Revision {
  const application = getApplication(db, publicId);
  if (application.lifecycle === "retired") throw new TransitionError(`${applicationName(application)} is retired, so it can't change`);
  return startDraft(db, "application", application.id, actor, applicationDraftSchema.parse({ name: application.name ?? "", ownerTeam: application.ownerTeam, sealId: application.sealId }) as unknown as JsonObject);
}

/**
 * Saves the Draft. Its shape is checked, so global environments, required
 * capabilities, a host contract, or host configuration are refused outside
 * `legacy`. A confirmation stays only while the launch values it confirmed
 * are unchanged.
 */
export function saveApplicationDraft(db: Executor, publicId: string, input: { lockVersion: number; document: unknown }): Revision {
  const application = getApplication(db, publicId);
  const parsed = applicationDraftSchema.safeParse(input.document);
  if (!parsed.success) throw new ValidationError(issuesOf(parsed.error, ""));
  const draft = parsed.data;
  if (draft.confirmation && draft.confirmation.launchDigest !== launchDigest(draft.launch)) draft.confirmation = null;
  return saveDraft(db, "application", application.id, { lockVersion: input.lockVersion, document: draft });
}

/** A digest of the launch values a confirmation applies to. */
export function launchDigest(launch: LaunchDraft): string {
  const kind = launch.kind;
  return sha256(
    dump({
      kind,
      microfrontend: kind === "mfe" ? launch.microfrontend : null,
      mode: launch.mode,
      documentUrl: kind === "external" && launch.mode === "iframe" ? launch.documentUrl : null,
      moduleUrl: kind === "external" && launch.mode === "esm" ? launch.moduleUrl : null,
      exportedModule: launch.mode === "esm" ? launch.exportedModule : null,
      manifestUrl: kind === "external" && launch.mode === "module_federation_2" ? launch.manifestUrl : null,
      exposedModule: launch.mode === "module_federation_2" ? launch.exposedModule : null,
    }),
  );
}

// ---------------------------------------------------------------------------
// Rendering-mode inference

export interface RenderingCandidate {
  /** Stable for the same proposal from the same evidence. */
  key: string;
  mode: RenderingMode;
  /** The module the evidence names, for ESM and Module Federation 2. */
  module: string | null;
  /** The location the evidence names, when it names one. */
  location: string | null;
  source: "mfe_contract" | "studio" | "cdaas";
  evidence: string;
  observationId: number | null;
  observedAt: Date;
}

export interface Inference {
  candidates: RenderingCandidate[];
  /** True when every candidate proposes the same mode and module. */
  agreed: boolean;
}

/**
 * The rendering modes the evidence proposes for an MFE launch target: each
 * module its submitted rendering metadata names for a mode (for a v1
 * revision, what its contract implies), and the mode a current Studio
 * module observation states by its type. An external endpoint is never
 * fetched to guess its mode, and evidence that's unknown proposes nothing.
 */
export function inferRendering(db: Executor, launch: LaunchDraft, now = new Date()): Inference {
  if (launch.kind !== "mfe" || !launch.microfrontend) return { candidates: [], agreed: false };
  const mfe = findMicrofrontend(db, launch.microfrontend);
  if (!mfe?.activeRevisionId) return { candidates: [], agreed: false };
  const candidates: RenderingCandidate[] = [];
  const add = (candidate: Omit<RenderingCandidate, "key">) => candidates.push({ ...candidate, key: sha256(dump({ mode: candidate.mode, module: candidate.module, location: candidate.location, source: candidate.source, evidence: candidate.evidence })).slice(0, 32) });

  const revision = db.select().from(microfrontendRevisions).where(eq(microfrontendRevisions.id, mfe.activeRevisionId)).get()!;
  const rendering = renderingOfRevision(revision);
  if (rendering) {
    const evidence = contractLabel(mfe.name, revision.number, revision.formatVersion >= 2 ? "rendering metadata" : "contract");
    for (const mode of supportedModes(rendering)) {
      const modules = modulesFor(rendering, mode)!;
      for (const name of mode === "iframe" ? [null] : modules) add({ mode, module: name, location: mode === "iframe" ? (rendering.iframe?.entry ?? null) : null, source: "mfe_contract", evidence, observationId: null, observedAt: revision.submittedAt! });
    }
  }

  const studioModule = referenceOf(db, { kind: "microfrontend", id: mfe.id }, "studio", "module");
  if (studioModule) {
    const evidence = evidenceOf(db, studioModule, now);
    const observation = evidence.observation;
    if (observation?.outcome === "found" && !evidence.stale && !evidence.contractDrift && observation.projectionValue) {
      const projection = studioModuleProjection.safeParse(observation.projectionValue);
      const mode = projection.success ? modeOfStudioTypes(projection.data.typeLabels) : null;
      if (projection.success && mode) add({ mode, module: null, location: projection.data.url, source: "studio", evidence: `Studio module ${studioModule.externalId}`, observationId: observation.id, observedAt: observation.observedAt });
    }
  }
  const proposals = new Set(candidates.map((candidate) => `${candidate.mode}\u0000${candidate.module ?? ""}`));
  // A Studio type names the mode, not the module, so it agrees with a module the MFE names for that mode.
  const modes = new Set(candidates.map((candidate) => candidate.mode));
  const agreed = candidates.length > 0 && modes.size === 1 && new Set(candidates.filter((candidate) => candidate.module !== null).map((candidate) => candidate.module)).size <= 1 && proposals.size >= 1;
  return { candidates: candidates.sort((a, b) => compareCodeUnits(a.mode, b.mode) || compareCodeUnits(a.source, b.source) || compareCodeUnits(a.module ?? "", b.module ?? "")), agreed };
}

/**
 * The mapped evidence that proposes no rendering mode for an MFE launch
 * target, and why: a Studio module never read, not found, stale, read under
 * another contract, or with a type that names no mode. Unknown evidence is
 * shown as unknown, never as a proposal.
 */
export function silentEvidence(db: Executor, launch: Pick<LaunchDraft, "kind" | "microfrontend">, now = new Date()): string[] {
  if (launch.kind !== "mfe" || !launch.microfrontend) return [];
  const mfe = findMicrofrontend(db, launch.microfrontend);
  const studioModule = mfe ? referenceOf(db, { kind: "microfrontend", id: mfe.id }, "studio", "module") : undefined;
  if (!studioModule) return [];
  const evidence = evidenceOf(db, studioModule, now);
  const observation = evidence.observation;
  let why: string;
  if (!observation) why = evidence.lastRead ? "Studio hasn't answered a read of it yet" : "it hasn't been read yet";
  else if (observation.outcome !== "found") why = "Studio didn't find it at the last read";
  else if (evidence.stale) why = "its latest observation is stale";
  else if (evidence.contractDrift) why = "it was read under a Studio contract other than the pinned one";
  else {
    const projection = studioModuleProjection.safeParse(observation.projectionValue);
    if (projection.success && modeOfStudioTypes(projection.data.typeLabels)) return [];
    why = "its type doesn't name a rendering mode";
  }
  return [`Studio module ${studioModule.externalId} proposes nothing: ${why}`];
}

/** The rendering mode a Studio module's type states, or null when its types don't say. */
export function modeOfStudioTypes(labels: readonly string[]): RenderingMode | null {
  const modes = new Set<RenderingMode>();
  for (const label of labels) {
    if (/module\s*federation|\bmf2?\b|remote\s*entry/i.test(label)) modes.add("module_federation_2");
    else if (/\besm\b|es\s*module|javascript\s*module/i.test(label)) modes.add("esm");
    else if (/i-?frame/i.test(label)) modes.add("iframe");
  }
  return modes.size === 1 ? [...modes][0]! : null;
}

/**
 * Settles the rendering mode for the Draft's current launch values: by
 * confirming an inferred candidate, which also fills its values in; by
 * overriding the candidates with the values entered; or, with no candidate,
 * by choosing explicitly. The overridden candidates stay beside it.
 */
export function confirmRendering(db: Executor, publicId: string, input: { lockVersion: number; candidate: string | null; actor: Actor }): Revision {
  return immediate(db, (tx) => {
    const application = getApplication(tx, publicId);
    const draftRevision = draftOf(tx, "application", application.id);
    if (!draftRevision) throw new NotFoundError("This Application has no Draft");
    if (draftRevision.lockVersion !== input.lockVersion) throw new StaleRecordError(`Revision ${draftRevision.number} changed since you opened it`);
    const draft = readApplicationDraft(draftRevision);
    const { candidates } = inferRendering(tx, draft.launch);
    let kind: RenderingConfirmation;
    if (input.candidate) {
      const chosen = candidates.find((candidate) => candidate.key === input.candidate);
      if (!chosen) throw new ValidationError([{ field: "candidate", message: "That proposal is no longer supported by the evidence. Review the current proposals" }]);
      draft.launch.mode = chosen.mode;
      if (chosen.mode === "esm") draft.launch.exportedModule = chosen.module ?? draft.launch.exportedModule;
      if (chosen.mode === "module_federation_2") draft.launch.exposedModule = chosen.module ?? draft.launch.exposedModule;
      kind = "inferred";
    } else {
      if (!draft.launch.mode) throw new ValidationError([{ field: "launch.mode", message: "Choose a rendering mode" }]);
      kind = candidates.length > 0 ? "override" : "explicit";
    }
    draft.confirmation = { kind, candidate: input.candidate, by: input.actor.name, at: new Date().toISOString(), launchDigest: launchDigest(draft.launch) };
    return saveDraft(tx, "application", application.id, { lockVersion: input.lockVersion, document: draft });
  });
}

// ---------------------------------------------------------------------------
// Validation

interface ValidatedLaunch {
  kind: "mfe" | "external";
  microfrontend: Microfrontend | null;
  mode: RenderingMode;
  documentUrl: string | null;
  moduleUrl: string | null;
  exportedModule: string | null;
  manifestUrl: string | null;
  exposedModule: string | null;
  configuration: { sandbox: string[]; permissions: string[]; integrity: string | null };
  confirmation: NonNullable<ApplicationDraft["confirmation"]>;
  candidates: RenderingCandidate[];
}

interface ValidatedChild {
  microfrontend: Microfrontend;
  mountKind: "route" | "slot";
  mountKey: string;
  required: boolean;
  /** The child's module the host mounts; null for a child that can only be framed. */
  module: string | null;
}

interface ValidatedPlacement {
  placementId: number | null;
  portalId: number;
  menuParent: string | null;
  route: string;
  label: string;
  order: number;
  environments: string[];
  entitlements: { text: string; digest: string; value: Entitlements };
  defaultRequested: boolean;
}

export interface ValidatedApplication {
  /** The v2 document, with its placements in the Draft's order; submission orders it canonically. */
  document: JsonObject;
  name: string;
  ownerTeam: string;
  sealId: string | null;
  launch: ValidatedLaunch;
  children: ValidatedChild[];
  placements: ValidatedPlacement[];
  /** The environment catalog the placements were checked against. */
  catalog: { source: EnvironmentCatalogSource; digest: string };
}

/**
 * Validates an Application Draft as one graph: its identity; exactly one
 * launch target, with the values its rendering mode needs, a mode and
 * module the target's rendering metadata offers, and a confirmed mode; the
 * external endpoint's safety; each child binding, its mount, and the module
 * its host mounts; the source and CDaaS state of every registered MFE; and
 * each placement's Portal, route, menu parent, environments, entitlements,
 * and collisions. Nothing asks for Portal capabilities or host contracts.
 * Every issue is reported, at its field.
 */
export function validateApplicationDraft(db: Executor, application: Application, draft: ApplicationDraft, now = new Date(), catalog: EnvironmentCatalog = environmentCatalog(db, { now })): { issues: ValidationIssue[]; application: ValidatedApplication | null } {
  const issues = new IssueList();
  const name = draft.name.trim().replace(/\s+/g, " ");
  if (!name) issues.block("application.name_missing", "name", "Enter the Application's name");
  else if (name.length > 200) issues.block("application.name_invalid", "name", "Use 200 characters or fewer");
  const ownerTeam = draft.ownerTeam?.trim().replace(/\s+/g, " ") ?? "";
  if (!ownerTeam) issues.block("application.owner_missing", "ownerTeam", "Enter the team that owns this Application");
  else if (ownerTeam.length > 200) issues.block("application.owner_invalid", "ownerTeam", "Use 200 characters or fewer");
  const sealId = draft.sealId?.trim() || null;
  if (sealId && !SEAL_ID.test(sealId)) issues.block("application.seal_invalid", "sealId", "Enter a SEAL ID of letters, digits, dots, dashes, or underscores");

  const launch = validateLaunch(db, draft, issues, now);
  const children = validateChildren(db, draft, launch, issues, now);
  const placements = validatePlacements(db, application, draft, catalog, issues);
  for (const issue of draft.legacy?.issues ?? []) issues.block(issue.code, issue.location, issue.message);

  const complete = launch !== null && children.every((child) => child !== null) && placements.every((placement) => placement !== null);
  if (issues.blocking.length > 0 || !complete) return { issues: issues.issues, application: null };
  const validChildren = children as ValidatedChild[];
  const validPlacements = placements as ValidatedPlacement[];
  const document: JsonObject = {
    name,
    ownerTeam,
    sealId,
    launch: {
      kind: launch.kind,
      microfrontend: launch.microfrontend?.publicId ?? null,
      mode: launch.mode,
      documentUrl: launch.documentUrl,
      moduleUrl: launch.moduleUrl,
      exportedModule: launch.exportedModule,
      manifestUrl: launch.manifestUrl,
      exposedModule: launch.exposedModule,
      sandbox: launch.configuration.sandbox,
      permissions: launch.configuration.permissions,
      integrity: launch.configuration.integrity,
    },
    confirmation: launch.confirmation,
    children: validChildren.map((child) => ({ microfrontend: child.microfrontend.publicId, mountKind: child.mountKind, mountKey: child.mountKey, required: child.required, module: child.module })),
    placements: draft.placements.map((placement, index) => ({
      placement: placement.placement,
      portal: placement.portal,
      menuParent: validPlacements[index]!.menuParent,
      route: validPlacements[index]!.route,
      label: validPlacements[index]!.label,
      order: validPlacements[index]!.order,
      environments: validPlacements[index]!.environments,
      entitlements: validPlacements[index]!.entitlements.value as unknown as JsonObject,
      defaultRequested: validPlacements[index]!.defaultRequested,
    })),
  };
  return { issues: issues.issues, application: { document, name, ownerTeam, sealId, launch, children: validChildren, placements: validPlacements, catalog: { source: catalog.source, digest: catalog.digest } } };
}

function validateLaunch(db: Executor, draft: ApplicationDraft, issues: IssueList, now: Date): ValidatedLaunch | null {
  const launch = draft.launch;
  const hasUrls = [launch.documentUrl, launch.moduleUrl, launch.manifestUrl].some((value) => value?.trim());
  if (launch.kind === null) {
    if (launch.microfrontend && hasUrls) issues.block("launch.both_sources", "launch", "Choose one launch target: a registered MFE or an external endpoint, not both");
    else issues.block("launch.missing", "launch.kind", "Choose a launch target: a registered MFE or an external endpoint");
    return null;
  }
  if ((launch.kind === "mfe" && hasUrls) || (launch.kind === "external" && launch.microfrontend)) {
    issues.block("launch.both_sources", "launch", "Choose one launch target: a registered MFE or an external endpoint, not both");
    return null;
  }
  if (!launch.mode) {
    issues.block("launch.mode_missing", "launch.mode", "Choose how the Portal renders the target: iframe, ESM module, or Module Federation 2");
    return null;
  }
  let valid = true;
  let microfrontend: Microfrontend | null = null;
  let configuration: ValidatedLaunch["configuration"] = { sandbox: [], permissions: [], integrity: null };
  let values = { documentUrl: null as string | null, moduleUrl: null as string | null, exportedModule: null as string | null, manifestUrl: null as string | null, exposedModule: null as string | null };

  if (launch.kind === "mfe") {
    microfrontend = launch.microfrontend ? (findMicrofrontend(db, launch.microfrontend) ?? null) : null;
    if (!launch.microfrontend) {
      issues.block("launch.mfe_missing", "launch.microfrontend", "Choose the registered MFE the Portal launches");
      return null;
    }
    if (!microfrontend) {
      issues.block("launch.mfe_unknown", "launch.microfrontend", "That MFE isn't registered");
      return null;
    }
    const rendering = mfeState(db, microfrontend, "launch.microfrontend", "The launch MFE", issues, now);
    const parsed = mfeLaunchSchema.safeParse({ mode: launch.mode, ...(launch.mode === "iframe" ? { sandbox: launch.sandbox, permissions: launch.permissions } : launch.mode === "esm" ? { exportedModule: launch.exportedModule ?? "" } : { exposedModule: launch.exposedModule ?? "" }) });
    if (!parsed.success) {
      for (const issue of issuesOf(parsed.error, "launch")) issues.block(issue.field.endsWith("Module") ? "launch.module_missing" : "launch.configuration_invalid", issue.field, issue.field.endsWith("Module") ? `Choose the module ${microfrontend.name} offers for ${RENDERING_MODE_LABELS[launch.mode]}` : issue.message);
      valid = false;
    } else {
      const exported = parsed.data.mode === "esm" ? parsed.data.exportedModule : parsed.data.mode === "module_federation_2" ? parsed.data.exposedModule : null;
      const modules = rendering ? modulesFor(rendering, launch.mode) : undefined;
      if (modules === null) {
        issues.block("launch.mode_not_supported", "launch.mode", `${microfrontend.name} can't be loaded through ${RENDERING_MODE_LABELS[launch.mode]}: its rendering metadata offers ${describeModes(rendering!)}`);
        valid = false;
      } else if (modules && exported !== null && !modules.includes(exported)) {
        issues.block("launch.module_not_exported", `launch.${launch.mode === "esm" ? "exportedModule" : "exposedModule"}`, `${microfrontend.name} doesn't name ${exported} for ${RENDERING_MODE_LABELS[launch.mode]}; it names ${modules.join(", ")}`);
        valid = false;
      }
      if (parsed.data.mode === "esm") values.exportedModule = parsed.data.exportedModule;
      if (parsed.data.mode === "module_federation_2") values.exposedModule = parsed.data.exposedModule;
      if (parsed.data.mode === "iframe") configuration = { sandbox: parsed.data.sandbox, permissions: parsed.data.permissions, integrity: null };
    }
  } else {
    const candidate = { mode: launch.mode, documentUrl: launch.documentUrl ?? undefined, moduleUrl: launch.moduleUrl ?? undefined, exportedModule: launch.exportedModule ?? undefined, manifestUrl: launch.manifestUrl ?? undefined, exposedModule: launch.exposedModule ?? undefined, sandbox: launch.sandbox, permissions: launch.permissions, integrity: launch.integrity ?? undefined };
    const shaped = launch.mode === "iframe" ? { mode: "iframe", documentUrl: candidate.documentUrl, sandbox: candidate.sandbox, permissions: candidate.permissions } : launch.mode === "esm" ? { mode: "esm", moduleUrl: candidate.moduleUrl, exportedModule: candidate.exportedModule, ...(candidate.integrity ? { integrity: candidate.integrity } : {}) } : { mode: "module_federation_2", manifestUrl: candidate.manifestUrl, exposedModule: candidate.exposedModule };
    const parsed = externalLaunchSchema.safeParse(shaped);
    if (!parsed.success) {
      for (const issue of issuesOf(parsed.error, "launch")) {
        const missing = /expected string, received undefined|Required/i.test(issue.message);
        issues.block(missing ? "launch.value_missing" : /Url$/.test(issue.field) ? "launch.endpoint_unsafe" : "launch.configuration_invalid", issue.field, missing ? `Enter the ${describeField(issue.field)} ${RENDERING_MODE_LABELS[launch.mode]} rendering needs` : issue.message);
      }
      valid = false;
    } else {
      const data = parsed.data;
      if (data.mode === "iframe") {
        values.documentUrl = data.documentUrl;
        configuration = { sandbox: data.sandbox, permissions: data.permissions, integrity: null };
      } else if (data.mode === "esm") {
        values = { ...values, moduleUrl: data.moduleUrl, exportedModule: data.exportedModule };
        configuration = { sandbox: [], permissions: [], integrity: data.integrity ?? null };
      } else values = { ...values, manifestUrl: data.manifestUrl, exposedModule: data.exposedModule };
    }
  }

  const inference = inferRendering(db, launch, now);
  const confirmation = draft.confirmation;
  if (!confirmation || confirmation.launchDigest !== launchDigest(launch)) {
    issues.block(
      "launch.unconfirmed",
      "launch.mode",
      inference.candidates.length === 0 ? "Confirm the rendering mode and its values" : inference.agreed ? "Confirm the proposed rendering mode, or override it" : "The evidence proposes different rendering modes. Choose one, or override them",
    );
    valid = false;
  } else if (confirmation.kind === "inferred" && !inference.candidates.some((candidate) => candidate.key === confirmation.candidate)) {
    issues.block("launch.confirmation_stale", "launch.mode", "The evidence behind the confirmed rendering mode has changed. Confirm it again");
    valid = false;
  }
  if (!valid || !confirmation) return null;
  return { kind: launch.kind, microfrontend, mode: launch.mode, ...values, configuration, confirmation, candidates: inference.candidates };
}

function describeField(field: string): string {
  const key = field.split(".").at(-1) ?? field;
  return ({ documentUrl: "document URL", moduleUrl: "module URL", exportedModule: "exported module", manifestUrl: "manifest URL", exposedModule: "exposed module" } as Record<string, string>)[key] ?? key;
}

/** The modes rendering metadata offers, in a sentence. */
function describeModes(rendering: Rendering): string {
  const modes = supportedModes(rendering).map((mode) => RENDERING_MODE_LABELS[mode]);
  return modes.length ? modes.join(" and ") : "no mode";
}

/** The modules a host can mount from a child: its ESM exports and Module Federation 2 exposes. */
export function childModules(rendering: Rendering): string[] {
  return [...new Set([...(rendering.esm?.exports ?? []), ...(rendering.module_federation_2?.exposes ?? [])])].sort(compareCodeUnits);
}

/**
 * Checks a registered MFE an Application uses: registered, not retired,
 * submitted, built from an enabled Repository, and with a CDaaS view
 * reconciliation confirms. Returns how it can be rendered.
 */
function mfeState(db: Executor, mfe: Microfrontend, location: string, role: string, issues: IssueList, now: Date): Rendering | null {
  if (mfe.lifecycle === "retired") {
    issues.block("mfe.retired", location, `${role}, ${mfe.name}, is retired`);
    return null;
  }
  const readiness = microfrontendReadiness(db, mfe, now);
  if (!readiness.revision) {
    issues.block("mfe.not_submitted", location, `${role}, ${mfe.name}, has no submitted revision`);
    return null;
  }
  const source = readiness.checks.find((check) => check.code === "mfe.source");
  if (source && source.state !== "pass") issues.block("mfe.source_unavailable", location, `${role}, ${mfe.name}: ${source.message}`);
  if (readiness.cdaas.state !== "matching") issues.block(`cdaas.${readiness.cdaas.state}`, location, `${role}, ${mfe.name}: CDaaS view ${readiness.cdaas.state === "missing" ? "missing" : readiness.cdaas.state}. ${readiness.cdaas.reason}`);
  if (!readiness.rendering) issues.block("mfe.rendering_missing", location, `${role}, ${mfe.name}, names no way to render it`);
  return readiness.rendering;
}

function validateChildren(db: Executor, draft: ApplicationDraft, launch: ValidatedLaunch | null, issues: IssueList, now: Date): (ValidatedChild | null)[] {
  const seen = new Map<string, number>();
  const mounts = new Map<string, number>();
  return draft.children.map((child, index) => {
    const at = `children.${index}`;
    let valid = true;
    const fail = (code: string, field: string, message: string) => {
      issues.block(code, field ? `${at}.${field}` : at, message);
      valid = false;
    };
    const mfe = findMicrofrontend(db, child.microfrontend);
    if (!mfe) {
      fail("composition.mfe_unknown", "microfrontend", "That MFE isn't registered");
      return null;
    }
    let bound = true;
    if (launch?.microfrontend?.id === mfe.id) {
      fail("composition.child_is_entry", "microfrontend", `${mfe.name} is the launch target, so it's the entry, not a child`);
      bound = false;
    } else if (seen.has(mfe.publicId)) {
      fail("composition.duplicate", "microfrontend", `${mfe.name} is bound more than once`);
      bound = false;
    }
    seen.set(mfe.publicId, index);
    let mountKey = child.mountKey.trim();
    let mounted = true;
    if (!child.mountKind) {
      fail("composition.mount_missing", "mountKind", "Choose whether the child mounts at a route or in a slot");
      mounted = false;
    } else if (child.mountKind === "route") {
      const route = normalizeRoute(mountKey);
      if (route.problem) {
        fail("composition.mount_invalid", "mountKey", ROUTE_PROBLEMS[route.problem]);
        mounted = false;
      } else mountKey = route.route;
    } else if (!MOUNT_KEY.test(mountKey)) {
      fail("composition.mount_invalid", "mountKey", "A slot is lowercase letters, digits, and dashes, such as sidebar");
      mounted = false;
    }
    if (child.mountKind && mounted) {
      const mount = `${child.mountKind}:${mountKey}`;
      if (mounts.has(mount)) fail("composition.mount_duplicate", "mountKey", `Another child already mounts at ${child.mountKind === "route" ? "route" : "slot"} ${mountKey}`);
      mounts.set(mount, index);
    }
    // A binding that can't stand isn't checked further: its MFE's state would only add noise.
    const rendering = bound ? mfeState(db, mfe, at, "The child MFE", issues, now) : null;
    let hosted = child.module?.trim() || null;
    if (rendering) {
      const offered = childModules(rendering);
      if (hosted !== null && !offered.includes(hosted)) fail("composition.module_unknown", "module", offered.length ? `${mfe.name} doesn't name ${hosted}; it names ${offered.join(", ")}` : `${mfe.name} names no module to mount; it can only be framed`);
      else if (hosted === null && offered.length === 1) hosted = offered[0]!;
      else if (hosted === null && offered.length > 1) fail("composition.module_missing", "module", `Choose which of ${mfe.name}'s modules the host mounts: ${offered.join(", ")}`);
    }
    if (!valid || !child.mountKind) return null;
    return { microfrontend: mfe, mountKind: child.mountKind, mountKey, required: child.required, module: hosted };
  });
}

/**
 * Checks each placement on its own, so one placement's problem never hides
 * another's: its Portal and route, its menu parent in the Portal's governing
 * revision, each environment against the ones that revision enables and the
 * catalog, its entitlements, and the routes other placements hold.
 */
function validatePlacements(db: Executor, application: Application, draft: ApplicationDraft, catalog: EnvironmentCatalog, issues: IssueList): (ValidatedPlacement | null)[] {
  const claimed = new Map<string, number>();
  const listed = new Set(catalog.environments.map((environment) => environment.key));
  const results = draft.placements.map((request, index): ValidatedPlacement | null => {
    const at = `placements.${index}`;
    let valid = true;
    const fail = (code: string, field: string, message: string) => {
      issues.block(code, `${at}.${field}`, message);
      valid = false;
    };
    const portal = db.select().from(portals).where(eq(portals.publicId, request.portal)).get();
    if (!portal) {
      fail("placement.portal_unknown", "portal", "That Portal doesn't exist");
      return null;
    }
    if (portal.lifecycle === "retired") fail("placement.portal_retired", "portal", `${portal.label} is retired`);
    const governing = governingRevision(db, portal);
    if (!governing) {
      fail("placement.portal_not_onboarded", "portal", `${portal.label} has no submitted configuration yet, so it can't take placements`);
      return null;
    }
    let placementId: number | null = null;
    if (request.placement) {
      const existing = db.select().from(applicationPlacements).where(eq(applicationPlacements.publicId, request.placement)).get();
      if (!existing || existing.applicationId !== application.id || existing.portalId !== portal.id) fail("placement.identity_mismatch", "placement", "This placement belongs to another Application or Portal");
      else placementId = existing.id;
    }
    const route = normalizeRoute(request.route);
    if (route.problem) fail("placement.route_invalid", "route", ROUTE_PROBLEMS[route.problem]);
    const label = request.label.trim().replace(/\s+/g, " ");
    if (!label || label.length > 100) fail("placement.label_invalid", "label", "Enter the menu label, 100 characters or fewer");
    const menuParent = request.menuParent?.trim() || null;
    const groups = new Set(db.select({ key: portalMenuGroups.key }).from(portalMenuGroups).where(eq(portalMenuGroups.portalRevisionId, governing.id)).all().map((group) => group.key));
    if (menuParent && (!MENU_KEY.test(menuParent) || !groups.has(menuParent))) fail("placement.menu_parent_unknown", "menuParent", `${portal.label} has no menu group ${menuParent}`);
    const portalEnvironmentRows = db.select().from(portalEnvironments).where(eq(portalEnvironments.portalRevisionId, governing.id)).all();
    const wanted = inCatalogOrder(catalog, request.environments.map((environment) => environment.trim()).filter(Boolean));
    if (wanted.length === 0) fail("placement.environment_missing", "environments", `Choose at least one of ${portal.label}'s environments for this placement`);
    for (const environment of wanted) {
      const name = environmentLabel(catalog, environment);
      const portalEnvironment = portalEnvironmentRows.find((row) => row.environment === environment);
      if (!portalEnvironment) fail("placement.environment_unavailable", "environments", `${name} is unavailable for this placement: ${portal.label} doesn't enable it`);
      else if (!portalEnvironment.enabled) fail("placement.environment_disabled", "environments", `${name} is unavailable for this placement: ${portal.label}'s ${name} environment is disabled`);
      else if (!listed.has(environment)) fail("placement.environment_not_in_catalog", "environments", `${name} is no longer in the ${catalog.source === "studio" ? "Studio" : "fallback"} environment catalog`);
    }
    let entitlements: ValidatedPlacement["entitlements"] | null = null;
    try {
      const canonical = canonicalize(entitlementsSchema, request.entitlements, `${at}.entitlements`);
      entitlements = { text: canonical.text, digest: canonical.digest, value: canonical.value };
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      for (const issue of error.issues) issues.block("placement.entitlements_invalid", issue.field, issue.message);
      valid = false;
    }
    if (route.route) {
      for (const environment of wanted) {
        const key = `${portal.id}\u0000${environment}\u0000${route.route}`;
        if (claimed.has(key)) {
          fail("placement.route_collision", "route", `Another placement in this revision requests ${route.route} in ${portal.label} ${environmentLabel(catalog, environment)}`);
          issues.block("placement.route_collision", `placements.${claimed.get(key)}.route`, `Another placement in this revision requests ${route.route} in ${portal.label} ${environmentLabel(catalog, environment)}`);
        }
        claimed.set(key, index);
        const occupant = db
          .select({ placement: placementRoutes.placementId, application: applications.name, publicId: applications.publicId })
          .from(placementRoutes)
          .innerJoin(applications, eq(applications.id, placementRoutes.applicationId))
          .where(and(eq(placementRoutes.portalId, portal.id), eq(placementRoutes.environment, environment), eq(placementRoutes.route, route.route), eq(placementRoutes.active, true)))
          .get();
        if (occupant && occupant.placement !== placementId) fail("placement.route_collision", "route", `${portal.label} ${environmentLabel(catalog, environment)} already serves ${route.route} for ${occupant.application ?? occupant.publicId}`);
      }
    }
    if (!valid || !route.route || !entitlements) return null;
    return { placementId, portalId: portal.id, menuParent, route: route.route, label, order: request.order, environments: wanted, entitlements, defaultRequested: request.defaultRequested };
  });
  draft.placements.forEach((request, index) => {
    if (request.placement && draft.placements.findIndex((other) => other.placement === request.placement) !== index) issues.block("placement.duplicate", `placements.${index}.placement`, "This placement is requested twice");
  });
  return results;
}

// ---------------------------------------------------------------------------
// Rendering changes

export interface BindingCompatibility {
  application: Pick<Application, "publicId" | "name" | "sealId">;
  revision: number;
  role: "entry" | "child";
  /** What the binding uses, such as "launch, Module Federation 2 ./App" or "slot search, ./Widget". */
  uses: string;
  issues: ValidationIssue[];
}

/**
 * How +rendering+, such as an MFE Draft's, fares in each binding of +mfe+ in
 * an Application's current revision: an entry's launch mode and module must
 * still be offered, and a child's mounted module must still be named. It
 * previews a change before submission and changes nothing.
 */
export function renderingCompatibility(db: Executor, mfe: Microfrontend, rendering: Rendering): BindingCompatibility[] {
  const bindings = db
    .select({ application: applications, component: applicationComponents, revision: applicationRevisions })
    .from(applicationComponents)
    .innerJoin(applications, eq(applications.activeRevisionId, applicationComponents.applicationRevisionId))
    .innerJoin(applicationRevisions, eq(applicationRevisions.id, applicationComponents.applicationRevisionId))
    .where(eq(applicationComponents.microfrontendId, mfe.id))
    .orderBy(asc(applications.name), asc(applications.publicId))
    .all();
  return bindings.map(({ application, component, revision }) => {
    const issues: ValidationIssue[] = [];
    let uses: string;
    if (component.role === "child") {
      uses = `${component.mountKind} ${component.mountKey}${component.module ? `, ${component.module}` : ""}`;
      if (component.module && !childModules(rendering).includes(component.module)) issues.push({ code: "composition.module_unknown", severity: "blocking", location: uses, message: `It no longer names ${component.module}, which ${applicationName(application)} mounts at ${component.mountKind} ${component.mountKey}` });
    } else {
      const target = db.select().from(applicationLaunchTargets).where(eq(applicationLaunchTargets.applicationRevisionId, revision.id)).get()!;
      const exported = target.renderingMode === "esm" ? target.exportedModule : target.renderingMode === "module_federation_2" ? target.exposedModule : null;
      uses = `launch, ${RENDERING_MODE_LABELS[target.renderingMode]}${exported ? ` ${exported}` : ""}`;
      const modules = modulesFor(rendering, target.renderingMode);
      if (modules === null) issues.push({ code: "launch.mode_not_supported", severity: "blocking", location: "launch", message: `It can no longer be loaded through ${RENDERING_MODE_LABELS[target.renderingMode]}, which ${applicationName(application)} launches it with` });
      else if (exported !== null && !modules.includes(exported)) issues.push({ code: "launch.module_not_exported", severity: "blocking", location: "launch", message: `It no longer names ${exported} for ${RENDERING_MODE_LABELS[target.renderingMode]}, which ${applicationName(application)} launches` });
    }
    return { application: { publicId: application.publicId, name: application.name, sealId: application.sealId }, revision: revision.number, role: component.role, uses, issues };
  });
}

export interface PlacementChecks {
  /** What was compared, each named by record and revision. */
  compared: string[];
  issues: ValidationIssue[];
}

/**
 * What a placement's reviewer needs checked now: that each requested
 * environment is still one the Portal's governing revision enables, and
 * that the requested route is free in each. It reads nothing external and
 * changes nothing.
 */
export function placementChecks(db: Executor, input: { portal: typeof portals.$inferSelect; placementId: number; route: string; environments: readonly string[] }): PlacementChecks {
  const issues: ValidationIssue[] = [];
  const governing = governingRevision(db, input.portal);
  const compared = governing ? [`${input.portal.label} revision ${governing.number} environments`] : [];
  const enabled = new Set(governing ? db.select().from(portalEnvironments).where(eq(portalEnvironments.portalRevisionId, governing.id)).all().filter((row) => row.enabled).map((row) => row.environment) : []);
  for (const environment of input.environments) {
    if (!enabled.has(environment)) issues.push({ code: "placement.environment_unavailable", severity: "blocking", location: `environments.${environment}`, message: `${input.portal.label} has no enabled ${environment.toUpperCase()} environment now` });
    const occupant = db
      .select({ application: applications.name, publicId: applications.publicId })
      .from(placementRoutes)
      .innerJoin(applications, eq(applications.id, placementRoutes.applicationId))
      .where(and(eq(placementRoutes.portalId, input.portal.id), eq(placementRoutes.environment, environment), eq(placementRoutes.route, input.route), eq(placementRoutes.active, true), ne(placementRoutes.placementId, input.placementId)))
      .get();
    if (occupant) issues.push({ code: "placement.route_collision", severity: "blocking", location: "route", message: `${input.portal.label} ${environment.toUpperCase()} already serves ${input.route} for ${occupant.application ?? occupant.publicId}` });
  }
  return { compared, issues };
}

// ---------------------------------------------------------------------------
// Submission

/**
 * Submits the Application's Draft in one transaction, validating its
 * placements against the environment catalog in use now. With any blocking
 * issue nothing but the validation result is written. Otherwise the launch
 * target, the inference candidates beside the confirmed mode, the entry and
 * child bindings, and a request for each placement are frozen with the
 * revision, beside the catalog's source and digest, and the revision
 * becomes the Application's current one. Each request is Pending until its
 * Portal's owner decides it.
 */
export function submitApplication(db: Executor, publicId: string, input: { lockVersion: number; actor: Actor }): SubmitResult {
  const application = getApplication(db, publicId);
  if (application.lifecycle === "retired") throw new TransitionError(`${applicationName(application)} is retired, so it can't change`);
  return submitDraft(db, "application", application.id, {
    lockVersion: input.lockVersion,
    actor: input.actor,
    prepare: (tx, draft) => {
      const { issues, application: valid } = validateApplicationDraft(tx, application, readApplicationDraft(draft));
      if (!valid) return { issues, activate: false };
      // A new placement gets its ID now, so the frozen revision names it and the next Draft revises it rather than requesting another.
      const requested = valid.document.placements as JsonObject[];
      const placementIds = requested.map((entry) => (entry.placement as string | null) ?? generatePublicId("plc"));
      return {
        issues,
        document: canonicalDocument("application", 2, { ...valid.document, placements: requested.map((entry, index) => ({ ...entry, placement: placementIds[index]! })) }).value,
        activate: true,
        revisionColumns: { name: valid.name, owner_team: valid.ownerTeam, seal_id: valid.sealId, environment_catalog_source: valid.catalog.source, environment_catalog_digest: valid.catalog.digest },
        identityColumns: { name: valid.name, owner_team: valid.ownerTeam, seal_id: valid.sealId },
        freeze: (tx2, revisionId) => freezeApplication(tx2, application, revisionId, valid, placementIds),
        after: (tx2) => {
          refreshApplicationReadiness(tx2, getApplication(tx2, publicId), input.actor);
        },
      };
    },
  });
}

function freezeApplication(db: Executor, application: Application, revisionId: number, valid: ValidatedApplication, placementIds: readonly string[]): void {
  const now = new Date();
  const { launch } = valid;
  const configuration = canonicalize(z.record(z.string(), z.unknown()), launch.kind === "external" && launch.mode === "esm" ? (launch.configuration.integrity ? { integrity: launch.configuration.integrity } : {}) : launch.mode === "iframe" ? { sandbox: launch.configuration.sandbox, permissions: launch.configuration.permissions } : {});
  db.insert(applicationLaunchTargets)
    .values({
      applicationRevisionId: revisionId,
      kind: launch.kind,
      microfrontendId: launch.microfrontend?.id ?? null,
      renderingMode: launch.mode,
      documentUrl: launch.documentUrl,
      moduleUrl: launch.moduleUrl,
      exportedModule: launch.exportedModule,
      manifestUrl: launch.manifestUrl,
      exposedModule: launch.exposedModule,
      configuration: configuration.text,
      confirmation: launch.confirmation.kind,
      confirmedBy: launch.confirmation.by,
      confirmedAt: new Date(launch.confirmation.at),
    })
    .run();
  for (const candidate of launch.candidates) {
    db.insert(renderingInferenceCandidates)
      .values({
        applicationRevisionId: revisionId,
        renderingMode: candidate.mode,
        configuration: canonicalize(z.record(z.string(), z.unknown()), { module: candidate.module, location: candidate.location }).text,
        source: candidate.source,
        evidenceReference: candidate.evidence,
        observationId: candidate.observationId,
        observedAt: candidate.observedAt,
        chosen: launch.confirmation.kind === "inferred" && launch.confirmation.candidate === candidate.key,
      })
      .run();
  }
  if (launch.kind === "mfe") db.insert(applicationComponents).values({ applicationRevisionId: revisionId, microfrontendId: launch.microfrontend!.id, role: "entry", required: true }).run();
  for (const child of valid.children) {
    db.insert(applicationComponents).values({ applicationRevisionId: revisionId, microfrontendId: child.microfrontend.id, role: "child", mountKind: child.mountKind, mountKey: child.mountKey, required: child.required, module: child.module }).run();
  }
  for (const [index, placement] of valid.placements.entries()) {
    const placementId = placement.placementId ?? db.insert(applicationPlacements).values({ publicId: placementIds[index]!, applicationId: application.id, portalId: placement.portalId, createdAt: now }).returning().get().id;
    const request = db
      .insert(placementRequests)
      .values({
        placementId,
        applicationRevisionId: revisionId,
        menuParentKey: placement.menuParent,
        route: placement.route,
        label: placement.label,
        ordering: placement.order,
        entitlements: placement.entitlements.text,
        entitlementsDigest: placement.entitlements.digest,
        defaultRequested: placement.defaultRequested,
        createdAt: now,
      })
      .returning()
      .get();
    for (const environment of placement.environments) db.insert(placementRequestEnvironments).values({ placementRequestId: request.id, environment }).run();
  }
}

// ---------------------------------------------------------------------------
// Readiness

export interface ApplicationReadinessCheck {
  code: string;
  label: string;
  state: "pass" | "fail" | "unknown" | "stale";
  message: string;
}

export interface ApplicationReadiness {
  ready: boolean;
  checks: ApplicationReadinessCheck[];
  revision: Revision | null;
}

/**
 * Whether an Application is Ready now: its current revision launches a
 * confirmed target; every registered MFE it uses, entry or child, is
 * confirmed by CDaaS reconciliation; and at least one placement is
 * approved. An external target needs no CDaaS view, and a placement still
 * pending in another Portal doesn't hold readiness back.
 */
export function applicationReadiness(db: Executor, application: Application, now = new Date()): ApplicationReadiness {
  const checks: ApplicationReadinessCheck[] = [];
  const check = (code: string, label: string, state: ApplicationReadinessCheck["state"], message: string) => checks.push({ code, label, state, message });
  if (application.lifecycle === "retired") check("application.retired", "Lifecycle", "fail", `${applicationName(application)} is retired`);
  const revision = application.activeRevisionId ? (revisionById(db, "application", application.activeRevisionId) ?? null) : null;
  if (!revision) {
    check("application.not_submitted", "Revision", "fail", "No revision has been submitted");
    return { ready: false, checks, revision };
  }
  const row = db.select().from(applicationRevisions).where(eq(applicationRevisions.id, revision.id)).get()!;
  check("application.ownership", "Owning team", row.ownerTeam ? "pass" : "fail", row.ownerTeam ? `Owned by ${row.ownerTeam}` : "No owning team");
  const target = db.select().from(applicationLaunchTargets).where(eq(applicationLaunchTargets.applicationRevisionId, revision.id)).get();
  if (!target) check("launch.missing", "Launch target", "fail", "No launch target");
  else {
    const confirmedBy = { inferred: "confirmed from the evidence", override: "chosen over the inferred mode", explicit: "chosen explicitly" }[target.confirmation];
    check("launch.confirmed", "Launch target", "pass", `${target.kind === "mfe" ? "Registered MFE" : "External endpoint"} through ${RENDERING_MODE_LABELS[target.renderingMode]}, ${confirmedBy} by ${target.confirmedBy}, unverified`);
  }
  const components = db.select({ microfrontend: microfrontends, role: applicationComponents.role }).from(applicationComponents).innerJoin(microfrontends, eq(microfrontends.id, applicationComponents.microfrontendId)).where(eq(applicationComponents.applicationRevisionId, revision.id)).all();
  for (const component of components) {
    const readiness = microfrontendReadiness(db, component.microfrontend, now);
    const failing = readiness.checks.find((item) => item.state !== "pass");
    const role = component.role === "entry" ? "Entry MFE" : "Child MFE";
    check(`mfe.${component.role}`, `${role} ${component.microfrontend.name}`, failing ? failing.state : "pass", failing ? failing.message : "Ready, with its CDaaS view confirmed");
  }
  const states = placementStatesOf(db, application.id);
  const approved = states.filter((state) => state.effective === "approved");
  check(
    "placement.approved",
    "Placements",
    approved.length > 0 ? "pass" : "fail",
    approved.length > 0 ? `Approved in ${[...new Set(approved.map((state) => state.portalName))].sort(compareCodeUnits).join(", ")}` : states.length === 0 ? "No placement is requested" : "No placement is approved yet",
  );
  return { ready: checks.every((item) => item.state === "pass"), checks, revision };
}

export interface PlacementStateRow {
  placementId: number;
  placement: string;
  portalId: number;
  portal: string;
  portalName: string;
  /** The state of the placement's latest request. */
  latest: "pending" | "approved" | "rejected" | "withdrawn" | "retired";
  /** What the Portal serves: approved while an earlier approval stays active under a newer pending request. */
  effective: "pending" | "approved" | "rejected" | "withdrawn" | "retired";
  revision: number;
}

/** Each placement of an Application, with its latest request's state and what the Portal serves now. */
export function placementStatesOf(db: Executor, applicationId: number): PlacementStateRow[] {
  const rows = db.all<{ placement_id: number; placement: string; portal_id: number; portal: string; portal_name: string; request_id: number; revision: number; decision: string | null }>(sql`
    select p.id as placement_id, p.public_id as placement, po.id as portal_id, po.public_id as portal, po.label as portal_name, r.id as request_id, ar.number as revision,
      (select decision from placement_decisions d where d.placement_request_id = r.id order by sequence desc limit 1) as decision
    from application_placements p
    join portals po on po.id = p.portal_id
    join placement_requests r on r.placement_id = p.id
    join application_revisions ar on ar.id = r.application_revision_id
    where p.application_id = ${applicationId}
    order by p.id, ar.number desc`);
  const active = new Set(db.select({ placement: placementRoutes.placementId }).from(placementRoutes).where(and(eq(placementRoutes.applicationId, applicationId), eq(placementRoutes.active, true))).all().map((row) => row.placement));
  const seen = new Set<number>();
  const result: PlacementStateRow[] = [];
  for (const row of rows) {
    if (seen.has(row.placement_id)) continue;
    seen.add(row.placement_id);
    const latest = requestState(row.decision);
    result.push({ placementId: row.placement_id, placement: row.placement, portalId: row.portal_id, portal: row.portal, portalName: row.portal_name, latest, effective: active.has(row.placement_id) ? "approved" : latest, revision: row.revision });
  }
  return result.sort((a, b) => compareCodeUnits(a.portalName, b.portalName) || compareCodeUnits(a.placement, b.placement));
}

/** A request's state from its latest decision. */
export function requestState(decision: string | null): PlacementStateRow["latest"] {
  switch (decision) {
    case null:
      return "pending";
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "withdraw":
      return "withdrawn";
    default:
      return "retired";
  }
}

/** Moves the Application between Draft and Ready to match its readiness now, recording the change. */
export function refreshApplicationReadiness(db: Executor, application: Application, actor: Actor = SYSTEM_ACTOR, now = new Date()): Application {
  if (application.lifecycle === "retired" || !application.activeRevisionId) return application;
  const readiness = applicationReadiness(db, application, now);
  const to: LifecycleState = readiness.ready ? "ready" : "draft";
  if (to === application.lifecycle) return application;
  const updated = db.update(applications).set({ lifecycle: to, lockVersion: sql`${applications.lockVersion} + 1` }).where(eq(applications.id, application.id)).returning().get();
  recordEvent(db, "application", application.id, { event: to === "ready" ? "ready" : "not_ready", revision: readiness.revision?.number ?? null, from: application.lifecycle, to, actor, at: now, reason: to === "ready" ? null : readiness.checks.find((item) => item.state !== "pass")?.message });
  return updated;
}

/** Retires an Application, with a reason, once none of its placements is active. */
export function retireWebApplication(db: Executor, publicId: string, input: { lockVersion: number; reason: string; actor: Actor }): Application {
  return immediate(db, (tx) => {
    const application = getApplication(tx, publicId);
    if (application.lockVersion !== input.lockVersion) throw new StaleRecordError(`${applicationName(application)} changed since you opened it`);
    if (application.lifecycle === "retired") throw new TransitionError(`${applicationName(application)} is already retired`);
    const reason = input.reason.trim();
    if (!reason) throw new ValidationError([{ field: "reason", message: "Say why the Application is being retired" }]);
    if (reason.length > 1000) throw new ValidationError([{ field: "reason", message: "Use 1,000 characters or fewer" }]);
    const active = placementStatesOf(tx, application.id).filter((state) => state.effective === "approved");
    if (active.length > 0) {
      throw new BlockedError(`${applicationName(application)} can't be retired`, [
        { code: "application.retire_placements_active", severity: "blocking", location: "placements", message: `It's still placed in ${[...new Set(active.map((state) => state.portalName))].join(", ")}. Withdraw or retire ${active.length === 1 ? "that placement" : "those placements"} first` },
      ]);
    }
    const updated = tx.update(applications).set({ lifecycle: "retired", lockVersion: sql`${applications.lockVersion} + 1` }).where(eq(applications.id, application.id)).returning().get();
    retireReferencesOf(tx, { kind: "application", id: application.id });
    recordEvent(tx, "application", application.id, { event: "retired", reason, from: application.lifecycle, to: "retired", actor: input.actor });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Reading

export function applicationSummary(db: Executor, application: Application) {
  return { application, draft: draftOf(db, "application", application.id), latest: latestSubmitted(db, "application", application.id) };
}

/**
 * A submitted revision's frozen launch target, bindings, candidates, and
 * placement requests. A v2 revision also names the environment catalog its
 * placements were checked against; a v1 revision's global environments are
 * history.
 */
export function applicationRevisionView(db: Executor, revisionId: number) {
  const target = db.select({ target: applicationLaunchTargets, microfrontend: microfrontends }).from(applicationLaunchTargets).leftJoin(microfrontends, eq(microfrontends.id, applicationLaunchTargets.microfrontendId)).where(eq(applicationLaunchTargets.applicationRevisionId, revisionId)).get();
  const row = db.select({ catalogSource: applicationRevisions.environmentCatalogSource, catalogDigest: applicationRevisions.environmentCatalogDigest }).from(applicationRevisions).where(eq(applicationRevisions.id, revisionId)).get();
  return {
    target: target ?? null,
    catalog: row?.catalogSource && row.catalogDigest ? { source: row.catalogSource, digest: row.catalogDigest } : null,
    environments: db.select().from(applicationEnvironments).where(eq(applicationEnvironments.applicationRevisionId, revisionId)).orderBy(asc(applicationEnvironments.environment)).all().map((row) => row.environment),
    components: db.select({ component: applicationComponents, microfrontend: microfrontends }).from(applicationComponents).innerJoin(microfrontends, eq(microfrontends.id, applicationComponents.microfrontendId)).where(eq(applicationComponents.applicationRevisionId, revisionId)).orderBy(desc(applicationComponents.role), asc(microfrontends.name)).all(),
    candidates: db.select().from(renderingInferenceCandidates).where(eq(renderingInferenceCandidates.applicationRevisionId, revisionId)).orderBy(asc(renderingInferenceCandidates.id)).all(),
    requests: db
      .select({ request: placementRequests, placement: applicationPlacements, portal: portals })
      .from(placementRequests)
      .innerJoin(applicationPlacements, eq(applicationPlacements.id, placementRequests.placementId))
      .innerJoin(portals, eq(portals.id, applicationPlacements.portalId))
      .where(eq(placementRequests.applicationRevisionId, revisionId))
      .orderBy(asc(portals.label), asc(placementRequests.route))
      .all()
      .map((row) => ({ ...row, environments: db.select({ environment: placementRequestEnvironments.environment }).from(placementRequestEnvironments).where(eq(placementRequestEnvironments.placementRequestId, row.request.id)).all().map((item) => item.environment) })),
  };
}

export function applicationHistory(db: Executor, applicationId: number) {
  return db.select().from(onboardingEvents).where(eq(onboardingEvents.applicationId, applicationId)).orderBy(desc(onboardingEvents.occurredAt), desc(onboardingEvents.id)).all();
}

export interface PlacementCandidate {
  portal: { publicId: string; label: string; lifecycle: LifecycleState; onboarded: boolean };
  /** The ownership claim it comes from: who stated it, from where, and when. */
  claim: { assertion: string; providedBy: string; source: string; recordedAt: Date };
}

/**
 * The Portals ownership claims put an Application in that it has no
 * placement in yet: Draft candidates, kept as provenance. A claim never
 * becomes a placement, let alone an approved one, by itself; the team
 * requests a placement in a Draft and the Portal reviews it.
 */
export function placementCandidates(db: Executor, application: Application): PlacementCandidate[] {
  const owned = applicationOwnership(db, [application.id]).get(application.id);
  if (!owned) return [];
  const placed = new Set(db.select({ portalId: applicationPlacements.portalId }).from(applicationPlacements).where(eq(applicationPlacements.applicationId, application.id)).all().map((row) => row.portalId));
  return owned.portals
    .filter((membership) => !placed.has(membership.portal.id) && membership.provenance)
    .map((membership) => {
      const portal = db.select().from(portals).where(eq(portals.id, membership.portal.id)).get()!;
      const provenance = membership.provenance!;
      return {
        portal: { publicId: portal.publicId, label: portal.label, lifecycle: portal.lifecycle, onboarded: portal.lifecycle !== "retired" && governingRevision(db, portal) !== undefined },
        claim: { assertion: provenance.assertion, providedBy: provenance.providedBy, source: provenance.source, recordedAt: provenance.recordedAt },
      };
    })
    .sort((a, b) => compareCodeUnits(a.portal.label, b.portal.label));
}

/** Applications other than +except+ carrying +sealId+, so a person can tell same-SEAL records apart. */
export function sameSealApplications(db: Executor, sealId: string | null, except: number): Application[] {
  if (!sealId) return [];
  return db.select().from(applications).where(and(eq(applications.sealId, sealId), ne(applications.id, except))).orderBy(asc(applications.name)).all();
}

/**
 * A submitted revision's composition as plain text: its launch target and
 * rendering mode, then each child the target loads at runtime, with its
 * mount. Pages show it; the docs' diagrams are checked against it.
 */
export function compositionOutline(db: Executor, revisionId: number): string {
  const view = applicationRevisionView(db, revisionId);
  if (!view.target) return "No launch target";
  const { target, microfrontend } = view.target;
  const entry = target.renderingMode === "esm" ? `, exports ${target.exportedModule}` : target.renderingMode === "module_federation_2" ? `, exposes ${target.exposedModule}` : "";
  const source = target.kind === "mfe" ? `${microfrontend!.name} (registered MFE)` : `external endpoint ${target.documentUrl ?? target.moduleUrl ?? target.manifestUrl}`;
  const lines = [`Launch target: ${source}, ${RENDERING_MODE_LABELS[target.renderingMode]}${entry}`];
  const children = view.components.filter((row) => row.component.role === "child").sort((a, b) => compareCodeUnits(a.microfrontend.name, b.microfrontend.name));
  for (const { component, microfrontend: child } of children) lines.push(`  Child ${child.name}${component.module ? ` (${component.module})` : ""} at ${component.mountKind} ${component.mountKey}, ${component.required ? "required" : "optional"}`);
  return lines.join("\n");
}
