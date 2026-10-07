import { type JsonObject, compareCodeUnits } from "@repo-facts/contract";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { findSource } from "@/lib/catalog/source-records";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type LifecycleState, applicationComponents, applicationLaunchTargets, applications, microfrontendRevisions, microfrontends, onboardingEvents, repositorySources } from "@/lib/db/schema";
import { SEAL_ID } from "@/lib/ownership/records";
import { type Actor, SYSTEM_ACTOR, recordEvent } from "./attribution";
import { contractLabel } from "./contracts";
import { RENDERING_MODE_LABELS, canonicalize, issuesOf } from "./documents";
import { evidenceOf } from "./external/evidence";
import { type Comparison, reconcile } from "./external/reconcile";
import { declareReference, referenceOf, retireReference, retireReferencesOf } from "./external/references";
import { type MicrofrontendDraft, type Rendering, type RenderingDraft, canonicalDocument, draftOfDocument, microfrontendDraftSchema, modulesFor, renderingOfRevision, renderingSchema, supportedModes } from "./formats";
import { BlockedError, IssueList, type ValidationIssue } from "./issues";
import { type Revision, type SubmitResult, draftOf, latestSubmitted, revisionById, saveDraft, startDraft, submitDraft } from "./revisions";

/*
 * MFE assets (microfrontends spec). An MFE is a reusable code asset: one
 * source coordinate, a Repository plus an optional workspace path, the
 * CDaaS application view that represents it, and the modules each rendering
 * mode can load from it. Application teams find, register, and edit MFEs
 * while composing an Application; there's no separate MFE-team journey, but
 * the identity, history, and CDaaS evidence stay global so one MFE serves
 * many Applications. Its identity never depends on its SEAL ID, its CDaaS
 * IDs, or the versions CDaaS holds, and it has no global role: each
 * Application binding gives it one. It becomes Ready only when its
 * submitted revision is complete and current-state reconciliation confirms
 * its CDaaS view.
 */

export type Microfrontend = typeof microfrontends.$inferSelect;

/** A CDaaS appId or viewId: letters, digits, and . _ : / - */
export const CDAAS_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export { microfrontendDraftSchema, type MicrofrontendDraft };

/** A revision's Draft as v2 reads it: a v1 Draft is converted, its contract kept as history. */
export function readMicrofrontendDraft(revision: Pick<Revision, "number" | "formatVersion" | "document">): MicrofrontendDraft {
  return draftOfDocument("microfrontend", revision);
}

export function findMicrofrontend(db: Executor, publicId: string): Microfrontend | undefined {
  return db.select().from(microfrontends).where(eq(microfrontends.publicId, publicId)).get();
}

export function getMicrofrontend(db: Executor, publicId: string): Microfrontend {
  const mfe = findMicrofrontend(db, publicId);
  if (!mfe) throw new NotFoundError(`MFE ${publicId} doesn't exist`);
  return mfe;
}

// ---------------------------------------------------------------------------
// Source coordinates

export type WorkspacePath = { path: string | null; problem: null } | { path: null; problem: string };

/**
 * A workspace path relative to the Repository root, normalized: "./" and
 * repeated or trailing slashes are dropped. An absolute path, a "." or ".."
 * segment, or a character a path shouldn't hold is refused. Empty means the
 * Repository root.
 */
export function normalizeWorkspacePath(input: string | null | undefined): WorkspacePath {
  const value = (input ?? "").trim().replace(/\\/g, "/");
  if (!value || value === "." || value === "./") return { path: null, problem: null };
  if (value.startsWith("/")) return { path: null, problem: "Use a path relative to the Repository root, such as apps/search" };
  const segments = value.replace(/^\.\//, "").split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return { path: null, problem: 'A workspace path can\'t contain a "." or ".." segment' };
  if (segments.some((segment) => !/^[A-Za-z0-9._@-]+$/.test(segment))) return { path: null, problem: "A workspace path is letters, digits, and . _ @ -, separated by slashes" };
  const path = segments.join("/");
  if (path.length > 200) return { path: null, problem: "Use 200 characters or fewer" };
  return { path, problem: null };
}

// ---------------------------------------------------------------------------
// Creating and editing

export interface MicrofrontendInput {
  name: string;
  ownerTeam?: string | null;
  sealId?: string | null;
}

/** Registers an MFE and opens its first Draft. */
export function createMicrofrontend(db: Executor, input: MicrofrontendInput, actor: Actor): { microfrontend: Microfrontend; draft: Revision } {
  return immediate(db, (tx) => {
    const issues: { field: string; message: string }[] = [];
    const name = input.name.trim().replace(/\s+/g, " ");
    if (!name) issues.push({ field: "name", message: "Enter the MFE's name" });
    else if (name.length > 200) issues.push({ field: "name", message: "Use 200 characters or fewer" });
    const sealId = input.sealId?.trim() || null;
    if (sealId && !SEAL_ID.test(sealId)) issues.push({ field: "sealId", message: "Enter a SEAL ID of letters, digits, dots, dashes, or underscores" });
    const ownerTeam = input.ownerTeam?.trim().replace(/\s+/g, " ") || null;
    if (ownerTeam && ownerTeam.length > 200) issues.push({ field: "ownerTeam", message: "Use 200 characters or fewer" });
    if (issues.length) throw new ValidationError(issues);
    const microfrontend = tx.insert(microfrontends).values({ publicId: generatePublicId("mfe"), name, sealId, ownerTeam, createdAt: new Date() }).returning().get();
    recordEvent(tx, "microfrontend", microfrontend.id, { event: "created", actor, to: "draft" });
    const draft = startDraft(tx, "microfrontend", microfrontend.id, actor, microfrontendDraftSchema.parse({ name, ownerTeam, sealId }) as unknown as JsonObject);
    return { microfrontend: findMicrofrontend(tx, microfrontend.publicId)!, draft };
  });
}

export function startMicrofrontendDraft(db: Executor, publicId: string, actor: Actor): Revision {
  const mfe = getMicrofrontend(db, publicId);
  if (mfe.lifecycle === "retired") throw new TransitionError(`${mfe.name} is retired, so it can't change`);
  return startDraft(db, "microfrontend", mfe.id, actor, microfrontendDraftSchema.parse({ name: mfe.name, ownerTeam: mfe.ownerTeam, sealId: mfe.sealId }) as unknown as JsonObject);
}

export function saveMicrofrontendDraft(db: Executor, publicId: string, input: { lockVersion: number; document: unknown }): Revision {
  const mfe = getMicrofrontend(db, publicId);
  const parsed = microfrontendDraftSchema.safeParse(input.document);
  if (!parsed.success) throw new ValidationError(issuesOf(parsed.error, ""));
  return saveDraft(db, "microfrontend", mfe.id, { lockVersion: input.lockVersion, document: parsed.data });
}

// ---------------------------------------------------------------------------
// Validation and submission

export interface ValidatedMicrofrontend {
  document: JsonObject;
  name: string;
  ownerTeam: string;
  sealId: string | null;
  repositorySourceId: number;
  workspacePath: string | null;
  cdaas: { appId: string; viewId: string } | null;
  rendering: { value: Rendering; text: string };
}

/**
 * Validates an MFE Draft completely. Its source must be one enabled
 * Repository, and no other MFE that isn't retired may claim the same
 * Repository and workspace path or the same CDaaS view. A Draft may omit its
 * CDaaS view, but it can't become Ready without one. Its rendering metadata
 * must name how at least one mode loads it; nothing asks what it requires
 * of a host, provides, emits, or shares.
 */
export function validateMicrofrontendDraft(db: Executor, mfe: Microfrontend, draft: MicrofrontendDraft): { issues: ValidationIssue[]; microfrontend: ValidatedMicrofrontend | null } {
  const issues = new IssueList();
  const name = draft.name.trim().replace(/\s+/g, " ");
  if (!name) issues.block("mfe.name_missing", "name", "Enter the MFE's name");
  else if (name.length > 200) issues.block("mfe.name_invalid", "name", "Use 200 characters or fewer");
  const ownerTeam = draft.ownerTeam?.trim().replace(/\s+/g, " ") ?? "";
  if (!ownerTeam) issues.block("mfe.owner_missing", "ownerTeam", "Enter the team that owns this MFE");
  else if (ownerTeam.length > 200) issues.block("mfe.owner_invalid", "ownerTeam", "Use 200 characters or fewer");
  const sealId = draft.sealId?.trim() || null;
  if (sealId && !SEAL_ID.test(sealId)) issues.block("mfe.seal_invalid", "sealId", "Enter a SEAL ID of letters, digits, dots, dashes, or underscores");

  let repository: typeof repositorySources.$inferSelect | undefined;
  if (!draft.repository) issues.block("mfe.source_missing", "repository", "Choose the Repository that builds this MFE");
  else {
    repository = findSource(db, draft.repository);
    if (!repository) issues.block("mfe.source_unknown", "repository", "That Repository isn't in the catalog. Add it, then choose it");
    else if (!repository.enabled) issues.block("mfe.source_disabled", "repository", `${repository.name} is disabled in the catalog. Ask an operator to enable it, or choose another Repository`);
  }
  const workspace = normalizeWorkspacePath(draft.workspacePath);
  if (workspace.problem) issues.block("mfe.workspace_invalid", "workspacePath", workspace.problem);
  if (repository?.enabled && !workspace.problem) {
    const claimed = sourceHolders(db, repository.id, workspace.path, mfe.id);
    if (claimed.length > 0) issues.block("mfe.source_duplicate", "workspacePath", `${claimed.join(", ")} already ${claimed.length === 1 ? "builds" : "build"} from ${repository.name}${workspace.path ? ` at ${workspace.path}` : " at its root"}. Each MFE has its own source`);
  }

  let cdaas: ValidatedMicrofrontend["cdaas"] = null;
  if (draft.cdaas && (draft.cdaas.appId.trim() || draft.cdaas.viewId.trim())) {
    const appId = draft.cdaas.appId.trim();
    const viewId = draft.cdaas.viewId.trim();
    if (!CDAAS_ID.test(appId)) issues.block("mfe.cdaas_app_invalid", "cdaas.appId", "Enter the CDaaS appId: letters, digits, and . _ : -");
    if (!CDAAS_ID.test(viewId)) issues.block("mfe.cdaas_view_invalid", "cdaas.viewId", "Enter the CDaaS viewId: letters, digits, and . _ : -");
    if (CDAAS_ID.test(appId) && CDAAS_ID.test(viewId)) {
      cdaas = { appId, viewId };
      const holder = db
        .select({ name: microfrontends.name })
        .from(microfrontends)
        .where(and(eq(microfrontends.cdaasAppId, appId), eq(microfrontends.cdaasViewId, viewId), ne(microfrontends.lifecycle, "retired"), ne(microfrontends.id, mfe.id)))
        .get();
      if (holder) issues.block("mfe.cdaas_conflict", "cdaas", `The CDaaS view ${appId}/${viewId} belongs to the MFE ${holder.name}. One view represents one MFE`);
    }
  } else issues.warn("mfe.cdaas_missing", "cdaas", "Name the CDaaS appId and viewId. The MFE can't become Ready until reconciliation confirms them");

  let rendering: ValidatedMicrofrontend["rendering"] | null = null;
  try {
    const canonical = canonicalize(renderingSchema, normalizeRendering(draft.rendering), "rendering");
    rendering = { value: canonical.value, text: canonical.text };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    for (const issue of error.issues) issues.block(issue.message.startsWith("Say how") ? "mfe.rendering_missing" : "mfe.rendering_invalid", issue.field, issue.message);
  }
  for (const issue of draft.legacy?.issues ?? []) issues.block(issue.code, issue.location, issue.message);

  if (issues.blocking.length > 0 || !rendering || !repository) return { issues: issues.issues, microfrontend: null };
  const document = canonicalDocument("microfrontend", 2, { name, ownerTeam, sealId, repository: repository.publicId, workspacePath: workspace.path, cdaas, rendering: rendering.value }).value;
  return { issues: issues.issues, microfrontend: { document, name, ownerTeam, sealId, repositorySourceId: repository.id, workspacePath: workspace.path, cdaas, rendering } };
}

/** Rendering metadata as a person entered it, tidied: names trimmed, blanks and repeats dropped, an empty entry absent. */
export function normalizeRendering(rendering: RenderingDraft): RenderingDraft {
  const names = (values: readonly string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return {
    iframe: rendering.iframe ? { entry: rendering.iframe.entry?.trim() || null } : null,
    esm: rendering.esm ? { exports: names(rendering.esm.exports) } : null,
    module_federation_2: rendering.module_federation_2 ? { exposes: names(rendering.module_federation_2.exposes) } : null,
  };
}

/** The Draft's rendering metadata, or null while its fields don't make any. */
export function draftRendering(draft: MicrofrontendDraft): Rendering | null {
  const parsed = renderingSchema.safeParse(normalizeRendering(draft.rendering));
  return parsed.success ? parsed.data : null;
}

/** How rendering metadata reads in a sentence, such as "Module Federation 2 (./App) and ESM module (./Search)". */
export function describeRendering(rendering: Rendering): string {
  return supportedModes(rendering)
    .map((mode) => {
      const modules = modulesFor(rendering, mode)!;
      const detail = mode === "iframe" ? (rendering.iframe?.entry ?? null) : modules.join(", ");
      return detail ? `${RENDERING_MODE_LABELS[mode]} (${detail})` : RENDERING_MODE_LABELS[mode];
    })
    .join(" and ");
}

/** The other MFEs, not retired, whose submitted revision builds from the same Repository and path. */
function sourceHolders(db: Executor, repositoryId: number, path: string | null, except: number): string[] {
  return db
    .select({ name: microfrontends.name })
    .from(microfrontends)
    .innerJoin(microfrontendRevisions, eq(microfrontendRevisions.id, microfrontends.activeRevisionId))
    .where(
      and(
        eq(microfrontendRevisions.repositorySourceId, repositoryId),
        path === null ? sql`${microfrontendRevisions.workspacePath} IS NULL` : eq(microfrontendRevisions.workspacePath, path),
        ne(microfrontends.lifecycle, "retired"),
        ne(microfrontends.id, except),
      ),
    )
    .all()
    .map((row) => row.name)
    .sort(compareCodeUnits);
}

/**
 * Submits the MFE's Draft. With no blocking issue, its revision becomes
 * active, its CDaaS view is declared as an external reference, and its
 * readiness is checked again.
 */
export function submitMicrofrontend(db: Executor, publicId: string, input: { lockVersion: number; actor: Actor }): SubmitResult {
  const mfe = getMicrofrontend(db, publicId);
  if (mfe.lifecycle === "retired") throw new TransitionError(`${mfe.name} is retired, so it can't change`);
  return submitDraft(db, "microfrontend", mfe.id, {
    lockVersion: input.lockVersion,
    actor: input.actor,
    prepare: (tx, draft) => {
      const { issues, microfrontend: valid } = validateMicrofrontendDraft(tx, mfe, readMicrofrontendDraft(draft));
      if (!valid) return { issues, activate: false };
      return {
        issues,
        document: valid.document,
        activate: true,
        revisionColumns: {
          name: valid.name,
          owner_team: valid.ownerTeam,
          seal_id: valid.sealId,
          repository_source_id: valid.repositorySourceId,
          workspace_path: valid.workspacePath,
          cdaas_app_id: valid.cdaas?.appId ?? null,
          cdaas_view_id: valid.cdaas?.viewId ?? null,
          rendering: valid.rendering.text,
        },
        identityColumns: { name: valid.name, owner_team: valid.ownerTeam, seal_id: valid.sealId, cdaas_app_id: valid.cdaas?.appId ?? null, cdaas_view_id: valid.cdaas?.viewId ?? null },
        after: (tx2) => {
          const current = getMicrofrontend(tx2, publicId);
          const subject = { kind: "microfrontend" as const, id: mfe.id };
          const declared = referenceOf(tx2, subject, "cdaas", "application_view");
          if (valid.cdaas) declareReference(tx2, { system: "cdaas", resourceType: "application_view", externalId: `${valid.cdaas.appId}/${valid.cdaas.viewId}`, subject, source: "declared", actor: input.actor });
          else if (declared) retireReference(tx2, declared);
          refreshMicrofrontendReadiness(tx2, current, input.actor);
        },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Readiness

export type CheckState = "pass" | "fail" | "unknown" | "stale";

export interface ReadinessCheck {
  code: string;
  label: string;
  state: CheckState;
  message: string;
}

export interface MicrofrontendReadiness {
  ready: boolean;
  checks: ReadinessCheck[];
  cdaas: Comparison;
  revision: Revision | null;
  /** How its submitted revision can be rendered: frozen v2 metadata, or what a v1 contract implies. */
  rendering: Rendering | null;
}

/**
 * Whether an MFE is Ready: its submitted revision has a name, an owning
 * team, an enabled Repository, rendering metadata, and a CDaaS view that
 * reconciliation confirms now. Missing, Conflicting, Unknown, and Stale
 * evidence never counts as confirmed.
 */
export function microfrontendReadiness(db: Executor, mfe: Microfrontend, now = new Date()): MicrofrontendReadiness {
  const revision = mfe.activeRevisionId ? (revisionById(db, "microfrontend", mfe.activeRevisionId) ?? null) : null;
  const row = mfe.activeRevisionId ? db.select().from(microfrontendRevisions).where(eq(microfrontendRevisions.id, mfe.activeRevisionId)).get() : undefined;
  const checks: ReadinessCheck[] = [];
  const check = (code: string, label: string, state: CheckState, message: string) => checks.push({ code, label, state, message });
  if (mfe.lifecycle === "retired") check("mfe.retired", "Lifecycle", "fail", `${mfe.name} is retired`);
  if (!row) check("mfe.not_submitted", "Revision", "fail", "No revision has been submitted");
  else {
    check("mfe.identity", "Identity", row.name ? "pass" : "fail", row.name ? `Revision ${row.number} names it ${row.name}` : "Its revision has no name");
    check("mfe.ownership", "Owning team", row.ownerTeam ? "pass" : "fail", row.ownerTeam ? `Owned by ${row.ownerTeam}` : "No owning team");
    const source = row.repositorySourceId ? db.select().from(repositorySources).where(eq(repositorySources.id, row.repositorySourceId)).get() : undefined;
    check("mfe.source", "Repository", source?.enabled ? "pass" : "fail", !source ? "No Repository" : source.enabled ? `Built from ${source.name}${row.workspacePath ? ` at ${row.workspacePath}` : ""}` : `${source.name} is disabled in the catalog`);
  }
  const rendering = row ? renderingOfRevision(row) : null;
  if (row) check("mfe.rendering", "Rendering", rendering ? "pass" : "fail", rendering ? `Loads through ${describeRendering(rendering)}` : "No rendering mode can load it");
  const cdaas = cdaasComparison(db, mfe, row ?? null, now);
  check("mfe.cdaas", "CDaaS view", cdaas.state === "matching" ? "pass" : cdaas.state === "stale" ? "stale" : cdaas.state === "unknown" ? "unknown" : "fail", cdaas.reason);
  return { ready: checks.every((item) => item.state === "pass"), checks, cdaas, revision, rendering };
}

/** The MFE's declared CDaaS view against what CDaaS last reported. */
export function cdaasComparison(db: Executor, mfe: Microfrontend, row: typeof microfrontendRevisions.$inferSelect | null, now = new Date()): Comparison {
  const desired = row ? contractLabel(mfe.name, row.number, "CDaaS view") : `${mfe.name} CDaaS view`;
  if (!row?.cdaasAppId || !row.cdaasViewId) {
    return { state: "unknown", reason: "No CDaaS appId and viewId are declared", system: "cdaas", desired, reference: null, values: [], observedAt: null, readAt: null };
  }
  const reference = referenceOf(db, { kind: "microfrontend", id: mfe.id }, "cdaas", "application_view");
  return reconcile({
    system: "cdaas",
    resourceLabel: "CDaaS application view",
    desired,
    evidence: reference ? evidenceOf(db, reference, now) : null,
    expectations: [
      { label: "appId", expected: row.cdaasAppId, observed: (projection) => (projection.appId as string) ?? null },
      { label: "viewId", expected: row.cdaasViewId, observed: (projection) => (projection.viewId as string) ?? null },
    ],
  });
}

/** Moves the MFE between Draft and Ready to match its readiness now, recording the change. */
export function refreshMicrofrontendReadiness(db: Executor, mfe: Microfrontend, actor: Actor = SYSTEM_ACTOR, now = new Date()): Microfrontend {
  if (mfe.lifecycle === "retired") return mfe;
  const readiness = microfrontendReadiness(db, mfe, now);
  const to: LifecycleState = readiness.ready ? "ready" : "draft";
  if (to === mfe.lifecycle) return mfe;
  const updated = db.update(microfrontends).set({ lifecycle: to, lockVersion: sql`${microfrontends.lockVersion} + 1` }).where(eq(microfrontends.id, mfe.id)).returning().get();
  recordEvent(db, "microfrontend", mfe.id, { event: to === "ready" ? "ready" : "not_ready", revision: readiness.revision?.number ?? null, from: mfe.lifecycle, to, actor, at: now, reason: to === "ready" ? null : readiness.checks.find((item) => item.state !== "pass")?.message });
  return updated;
}

// ---------------------------------------------------------------------------
// Assets managed from an Application

export interface AssetChoice {
  microfrontend: Microfrontend;
  /** How its submitted revision renders; null before it's submitted. */
  rendering: Rendering | null;
  /** How many Applications' current revisions bind it. */
  uses: number;
}

/**
 * The shared MFEs an Application team can bind while composing: every MFE
 * that isn't retired, matched on name, owning team, SEAL ID, or CDaaS view,
 * with how it renders and how widely it's used. Choosing one binds that
 * identity; nothing is copied into the Application.
 */
export function findAssets(db: Executor, search = "", limit = 50): AssetChoice[] {
  const needle = search.trim().toLowerCase();
  const matches = (mfe: Microfrontend) => !needle || [mfe.name, mfe.ownerTeam, mfe.sealId, mfe.cdaasAppId && `${mfe.cdaasAppId}/${mfe.cdaasViewId}`, mfe.publicId].some((value) => value?.toLowerCase().includes(needle));
  const found = db.select().from(microfrontends).where(ne(microfrontends.lifecycle, "retired")).all().filter(matches);
  const renderings = activeRenderings(db, found.map((mfe) => mfe.id));
  const uses = new Map(
    db
      .select({ id: applicationComponents.microfrontendId, count: sql<number>`count(distinct ${applications.id})` })
      .from(applicationComponents)
      .innerJoin(applications, eq(applications.activeRevisionId, applicationComponents.applicationRevisionId))
      .groupBy(applicationComponents.microfrontendId)
      .all()
      .map((row) => [row.id, row.count]),
  );
  return found
    .map((mfe) => ({ microfrontend: mfe, rendering: renderings.get(mfe.id)?.rendering ?? null, uses: uses.get(mfe.id) ?? 0 }))
    .sort((a, b) => compareCodeUnits(a.microfrontend.name.toLowerCase(), b.microfrontend.name.toLowerCase()) || compareCodeUnits(a.microfrontend.publicId, b.microfrontend.publicId))
    .slice(0, limit);
}

const sameTeam = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

/**
 * Whether an Application's team may edit +mfe+ from its composition: one its
 * own team owns, or one no team owns yet. Another team's MFE can be bound
 * and opened, but its owners change it.
 */
export function assetAccess(application: { ownerTeam: string | null }, mfe: Pick<Microfrontend, "ownerTeam" | "lifecycle" | "name">): { editable: boolean; reason: string | null } {
  if (mfe.lifecycle === "retired") return { editable: false, reason: `${mfe.name} is retired` };
  if (!mfe.ownerTeam || sameTeam(mfe.ownerTeam, application.ownerTeam)) return { editable: true, reason: null };
  return { editable: false, reason: `${mfe.ownerTeam} owns ${mfe.name}, so they change it` };
}

/**
 * Registers an MFE from an Application's composition: one global MFE
 * identity, owned by the Application's team unless another is named, that
 * any Application can then bind.
 */
export function registerAssetFor(db: Executor, application: { ownerTeam: string | null; sealId: string | null }, input: Partial<MicrofrontendInput> & { name: string }, actor: Actor): { microfrontend: Microfrontend; draft: Revision } {
  return createMicrofrontend(db, { name: input.name, ownerTeam: input.ownerTeam?.trim() || application.ownerTeam, sealId: input.sealId === undefined ? application.sealId : input.sealId }, actor);
}

// ---------------------------------------------------------------------------
// Use and retirement

export interface MicrofrontendUse {
  application: { publicId: string; name: string | null; lifecycle: LifecycleState };
  revision: number;
  role: "entry" | "child";
  mount: string | null;
  launchKind: "mfe" | "external";
}

/** The Applications whose active revision binds this MFE, with the role and mount each gives it. */
export function microfrontendUses(db: Executor, mfeId: number): MicrofrontendUse[] {
  return db
    .select({
      publicId: applications.publicId,
      name: applications.name,
      lifecycle: applications.lifecycle,
      revision: sql<number>`(select number from application_revisions where id = ${applicationComponents.applicationRevisionId})`,
      role: applicationComponents.role,
      mountKind: applicationComponents.mountKind,
      mountKey: applicationComponents.mountKey,
      launchKind: applicationLaunchTargets.kind,
    })
    .from(applicationComponents)
    .innerJoin(applications, eq(applications.activeRevisionId, applicationComponents.applicationRevisionId))
    .innerJoin(applicationLaunchTargets, eq(applicationLaunchTargets.applicationRevisionId, applicationComponents.applicationRevisionId))
    .where(eq(applicationComponents.microfrontendId, mfeId))
    .orderBy(asc(applications.name), asc(applications.publicId))
    .all()
    .map((row) => ({
      application: { publicId: row.publicId, name: row.name, lifecycle: row.lifecycle },
      revision: row.revision,
      role: row.role,
      mount: row.mountKind ? `${row.mountKind === "route" ? "Route" : "Slot"} ${row.mountKey}` : null,
      launchKind: row.launchKind,
    }));
}

/** Retires an MFE, with a reason, once no Application that isn't retired binds it. */
export function retireMicrofrontend(db: Executor, publicId: string, input: { lockVersion: number; reason: string; actor: Actor }): Microfrontend {
  return immediate(db, (tx) => {
    const mfe = getMicrofrontend(tx, publicId);
    if (mfe.lockVersion !== input.lockVersion) throw new StaleRecordError(`${mfe.name} changed since you opened it`);
    if (mfe.lifecycle === "retired") throw new TransitionError(`${mfe.name} is already retired`);
    const reason = input.reason.trim();
    if (!reason) throw new ValidationError([{ field: "reason", message: "Say why the MFE is being retired" }]);
    if (reason.length > 1000) throw new ValidationError([{ field: "reason", message: "Use 1,000 characters or fewer" }]);
    const users = microfrontendUses(tx, mfe.id).filter((use) => use.application.lifecycle !== "retired");
    if (users.length > 0) {
      throw new BlockedError(`${mfe.name} can't be retired`, [
        { code: "mfe.retire_in_use", severity: "blocking", location: "uses", message: `${users.map((use) => use.application.name ?? use.application.publicId).join(", ")} ${users.length === 1 ? "uses" : "use"} it. Remove it from ${users.length === 1 ? "that Application" : "those Applications"} first` },
      ]);
    }
    const updated = tx.update(microfrontends).set({ lifecycle: "retired", lockVersion: sql`${microfrontends.lockVersion} + 1` }).where(eq(microfrontends.id, mfe.id)).returning().get();
    retireReferencesOf(tx, { kind: "microfrontend", id: mfe.id });
    recordEvent(tx, "microfrontend", mfe.id, { event: "retired", reason, from: mfe.lifecycle, to: "retired", actor: input.actor });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Reading

export function microfrontendSummary(db: Executor, mfe: Microfrontend) {
  return {
    microfrontend: mfe,
    draft: draftOf(db, "microfrontend", mfe.id),
    latest: latestSubmitted(db, "microfrontend", mfe.id),
    row: mfe.activeRevisionId ? db.select().from(microfrontendRevisions).where(eq(microfrontendRevisions.id, mfe.activeRevisionId)).get() : undefined,
  };
}

/** How several MFEs' submitted revisions can be rendered, by internal ID, for launch and composition checks. */
export function activeRenderings(db: Executor, ids: readonly number[]): Map<number, { microfrontend: Microfrontend; revision: typeof microfrontendRevisions.$inferSelect; rendering: Rendering | null }> {
  if (ids.length === 0) return new Map();
  const rows = db.select({ microfrontend: microfrontends, revision: microfrontendRevisions }).from(microfrontends).innerJoin(microfrontendRevisions, eq(microfrontendRevisions.id, microfrontends.activeRevisionId)).where(inArray(microfrontends.id, [...ids])).all();
  return new Map(rows.map((row) => [row.microfrontend.id, { ...row, rendering: renderingOfRevision(row.revision) }]));
}

export function microfrontendHistory(db: Executor, mfeId: number) {
  return db.select().from(onboardingEvents).where(eq(onboardingEvents.microfrontendId, mfeId)).orderBy(desc(onboardingEvents.occurredAt), desc(onboardingEvents.id)).all();
}
