import { and, count, eq } from "drizzle-orm";
import { type Repository, findRepository, isValidGitRef } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError, StaleRecordError, ValidationError, isUniqueViolation } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type BuildTrigger, JOB_PRIORITIES, applicationPreviews, applications, previewPreparations, repositories } from "@/lib/db/schema";
import { updateLocked } from "@/lib/db/optimistic";
import { PreviewAccessError, assertEnrolled, enrollRemote } from "@/lib/previews/access";
import { recordConfiguredResolution } from "@/lib/surveys/records";
import { type Condition, packageTraits } from "@/lib/previews/eligibility";
import { type PreviewPreparation, type QueueOptions, openPreparation, preparationPackages, preparationRefusal, rebuildPreview, startPreview } from "@/lib/previews/records";
import { requestScreenshot } from "@/lib/previews/screenshots";
import { type RefOptions, pinCommit } from "@/lib/previews/refs";
import { settleNewestHistory, startHistory } from "./history";
import { type ApplicationReason, type ApplicationRow, type SettleValues, applicationOfPackage, branchLabel, checkDetails, getApplicationRow, nameKey, normalizeDetails, settleApplications, slugFor } from "./records";
import { SAVED_PREVIEW_LIMIT, type SavedPreview, type SavedPreviewRow, findSavedPreview, getSavedPreviewRow, refLabel, savedPreviewKey, savedPreviewOfRef, settleSavedPreviews } from "./saved-previews";

/**
 * Building applications through the preview pipeline (add-applications,
 * design decision 2). Creating an application, a rebuild, a branch switch,
 * and the automatic check all start an attempt the same way: pin the
 * tracked branch's head, open that commit's preparation, which decides
 * eligibility from the commit's Profile, and, once it's decided, build the
 * application's package. The attempt is recorded on the application at once,
 * so it shows Building while the commit is still being profiled; hooks.ts
 * follows it from there. The current build stays in use until a newer one
 * succeeds.
 *
 * A saved preview of one of the application's branches or tags is built the
 * same way (restore-toolbar-tools-and-branch-previews, design decision 2):
 * both are build targets, and only an application's attempts are written to
 * its build history.
 */

/**
 * What the pipeline builds: an application's tracked branch, or one of its
 * saved previews. Either way, the application's Repository and package.
 */
export type BuildTarget =
  | { readonly kind: "application"; readonly row: ApplicationRow; readonly application: ApplicationRow }
  | { readonly kind: "saved"; readonly row: SavedPreviewRow; readonly application: ApplicationRow };

export const applicationTarget = (row: ApplicationRow): BuildTarget => ({ kind: "application", row, application: row });

/** The saved preview +row+ as a build target, with its application. */
export function savedTarget(db: Executor, row: SavedPreviewRow): Extract<BuildTarget, { kind: "saved" }> {
  const application = db.select().from(applications).where(eq(applications.id, row.applicationId)).get();
  if (!application) throw new NotFoundError(`Unknown application of saved preview ${row.publicId}`);
  return { kind: "saved", row, application };
}

/** A target as messages name it: "Orders portal", or "Orders portal (feature/new-nav)". */
function targetName(target: BuildTarget): string {
  return target.kind === "application" ? target.application.name : `${target.application.name} (${refLabel(target.row.ref)})`;
}

/** Why a build of an application can't start. */
export class ApplicationBuildError extends Error {
  override name = "ApplicationBuildError";

  constructor(
    readonly code: "active",
    message: string,
  ) {
    super(message);
  }
}

export interface CreateApplicationInput {
  readonly repository: string;
  /** The branch to track, short (main) or qualified (refs/heads/main). */
  readonly branch: string;
  readonly packageDir: string;
  /** The preparation of the branch's commit that onboarding decided eligibility with. */
  readonly preparation: string;
  readonly name: string;
  readonly description: string;
  /** Whether the operator confirmed they trust the repository's code to be built and served. */
  readonly trusted: boolean;
}

/**
 * Records an application, enrolls its remote for previews unless it's
 * enrolled already, and starts its first build, from the decided preparation
 * of its tracked branch's commit, in one transaction (design decision 10).
 * Throws ValidationError for its name and description, a missing trust
 * confirmation, a package that doesn't qualify or is already an application,
 * or a preparation that isn't the Repository's or isn't decided; and
 * PreviewAccessError while previews are off.
 * @public The Applications pages and their actions use this (add-applications tasks 5 to 8).
 */
export function createApplication(db: Executor, input: CreateApplicationInput, config: FrontendRegistryConfig = getConfig()): ApplicationRow {
  return immediate(db, (tx) => {
    const repository = tx.select().from(repositories).where(eq(repositories.publicId, input.repository)).get();
    if (!repository || repository.deletedAt !== null) throw new NotFoundError(`Unknown Repository ${input.repository}`);
    if (!config.previews.enabled) throw new PreviewAccessError("disabled", "Previews are turned off");
    const preparation = tx.select().from(previewPreparations).where(eq(previewPreparations.publicId, input.preparation)).get();
    const issues = new IssueCollector();
    const trackedRef = qualifiedBranch(input.branch);
    if (trackedRef === null) issues.add("branch", "Choose a branch");
    checkDetails(tx, input, issues);
    if (!preparation || preparation.repositoryId !== repository.id) issues.add("package", "Check the repository's eligibility again");
    else if (preparation.state !== "ready") issues.add("package", preparation.state === "profiling" ? "The commit is still being checked" : "No package of this commit can be previewed");
    else if (!preparationPackages(preparation).some((verdict) => verdict.directory === input.packageDir && verdict.qualifies)) issues.add("package", "Choose a package that can be previewed");
    const taken = applicationOfPackage(tx, repository.id, input.packageDir);
    if (taken) issues.add("package", `This package is already the application ${taken.name}`);
    if (!input.trusted) issues.add("trusted", "Confirm that you trust this repository's code. Creating the application builds and serves it.");
    issues.throwIfAny();

    const { name, description } = normalizeDetails(input);
    const now = new Date();
    let application: ApplicationRow;
    try {
      application = tx
        .insert(applications)
        .values({
          publicId: generatePublicId("app"),
          slug: slugFor(tx, name),
          name,
          nameKey: nameKey(name),
          description,
          repositoryId: repository.id,
          packageDir: input.packageDir,
          trackedRef: trackedRef!,
          latestPreparationId: preparation!.id,
          latestCommitSha: preparation!.commitSha,
          latestRequestedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ValidationError([{ field: "name", message: `${name} is already the name of an application, or its package is already one. Check both.` }]);
      throw error;
    }
    // The operator confirmed trust: the remote is enrolled, if it isn't already, with the first build.
    enrollRemote(tx, repository, application);
    startHistory(tx, application, "first", preparation!, now);
    startPackageBuild(tx, applicationTarget(application), preparation!);
    return getApplicationRow(tx, application.publicId);
  });
}

export interface BuildOptions extends RefOptions {
  /** Build the commit again even when it was already built: an operator's Rebuild. */
  readonly force?: boolean;
}

/**
 * Starts an attempt at the tracked branch's head (spec "New commits on the
 * tracked branch are built automatically"): pins the commit and opens its
 * preparation, then builds the package once the commit is decided. A
 * commit already built successfully is used as it is, unless +force+; one
 * whose build failed is built again. Throws ApplicationBuildError while an
 * attempt is active, and the pinning's errors when the branch can't be read.
 */
export async function buildApplication(db: Executor, publicId: string, options: BuildOptions = {}): Promise<ApplicationRow> {
  const config = options.config ?? getConfig();
  const before = getApplicationRow(db, publicId);
  refuseWhileActive(before);
  const repository = repositoryOf(db, before);
  assertEnrolled(db, config, repository);
  const pinned = await pinCommit(db, repository, { kind: "ref", name: before.trackedRef }, { ...options, config });
  return immediate(db, (tx) => {
    const application = getApplicationRow(tx, publicId);
    // Another request started an attempt while the branch was read.
    refuseWhileActive(application);
    const { preparation } = openPreparation(tx, repository, pinned);
    attach(tx, applicationTarget(application), preparation, { force: options.force, trigger: options.force ? "rebuild" : "automatic" });
    return getApplicationRow(tx, publicId);
  });
}

/**
 * An operator's Rebuild: a new attempt at the tracked branch's head, even when that commit was built or failed before. Unavailable while an attempt is active.
 * @public The Applications pages and their actions use this (add-applications tasks 5 to 8).
 */
export function rebuildApplication(db: Executor, publicId: string, options: RefOptions = {}): Promise<ApplicationRow> {
  return buildApplication(db, publicId, { ...options, force: true });
}

export interface ApplicationEdit {
  readonly name: string;
  readonly description: string;
  /** The branch to track, short or qualified. */
  readonly branch: string;
}

/**
 * Changes an application's name, description, and tracked branch (catalog
 * spec, "Applications can be edited and deleted"). The address stays. A new
 * branch is pinned first, so a branch that can't be read changes nothing,
 * and its head is built, replacing any attempt under way; the current build
 * stays in use until the new branch's build succeeds. A saved preview of the
 * new branch is removed, since the branch is then built as the application's
 * own (applications/saved-previews spec, "Saved previews end with their
 * application or tracked branch").
 * @public The Applications pages and their actions use this (add-applications tasks 5 to 8).
 */
export async function editApplication(db: Executor, publicId: string, expectedLockVersion: number, edit: ApplicationEdit, options: RefOptions = {}): Promise<ApplicationRow> {
  const config = options.config ?? getConfig();
  const before = getApplicationRow(db, publicId);
  const trackedRef = qualifiedBranch(edit.branch);
  const issues = new IssueCollector();
  if (trackedRef === null) issues.add("branch", "Enter a branch name");
  checkDetails(db, edit, issues, before.id);
  issues.throwIfAny();
  const moved = trackedRef !== before.trackedRef;
  const repository = repositoryOf(db, before);
  if (moved) assertEnrolled(db, config, repository);
  const pinned = moved ? await pinCommit(db, repository, { kind: "ref", name: trackedRef }, { ...options, config }) : null;

  return immediate(db, (tx) => {
    const current = getApplicationRow(tx, publicId);
    if (current.lockVersion !== expectedLockVersion) throw new StaleRecordError(`${current.name} was changed by someone else`);
    const recheck = new IssueCollector();
    checkDetails(tx, edit, recheck, current.id);
    recheck.throwIfAny();
    const { name, description } = normalizeDetails(edit);
    const updated = updateLocked(tx, applications, current, { name, nameKey: nameKey(name), description, trackedRef: trackedRef!, updatedAt: new Date() }, `${current.name} was changed by someone else`);
    if (!pinned) return updated;
    tx.delete(applicationPreviews).where(and(eq(applicationPreviews.applicationId, updated.id), eq(applicationPreviews.ref, trackedRef!))).run();
    attach(tx, applicationTarget(updated), openPreparation(tx, repository, pinned).preparation, { trigger: "branch" });
    return getApplicationRow(tx, publicId);
  });
}

// -- Saved previews ---------------------------------------------------------------

export interface SavedPreviewInput {
  /** The branch or tag, qualified: refs/heads/feature/new-nav or refs/tags/v1.1.0. */
  readonly ref: string;
}

/**
 * Saves a preview of a branch or tag of the application's remote
 * (applications/saved-previews spec, "An application keeps saved previews of
 * branches and tags"; design decision 2). The ref's head is pinned first, so
 * a ref that can't be read saves nothing; the row is then inserted and
 * attached to that commit in one transaction. A commit whose package Show
 * already built is settled at once, Ready when that build published, and no
 * second build starts. Returns the saved preview, and whether it was created:
 * a ref already saved returns the existing preview. Throws ValidationError,
 * on `ref`, for the tracked branch, a ref that isn't a branch or tag, and an
 * application that already keeps SAVED_PREVIEW_LIMIT previews; and
 * PreviewAccessError while previews are off or the remote isn't enrolled.
 * @public New preview and preview mode's Save as preview use it (tasks 3.2 and 3.3).
 */
export async function createSavedPreview(db: Executor, applicationPublicId: string, input: SavedPreviewInput, options: RefOptions = {}): Promise<{ saved: SavedPreview; created: boolean }> {
  const config = options.config ?? getConfig();
  if (!config.previews.enabled) throw new PreviewAccessError("disabled", "Previews are turned off");
  const application = getApplicationRow(db, applicationPublicId);
  const ref = qualifiedRef(input.ref);
  const existing = ref === null ? undefined : savedPreviewOfRef(db, application.publicId, ref);
  if (existing) return { saved: existing, created: false };
  refuseSaving(db, application, ref);
  const repository = repositoryOf(db, application);
  assertEnrolled(db, config, repository);
  const pinned = await pinCommit(db, repository, { kind: "ref", name: ref! }, { ...options, config });

  return immediate(db, (tx) => {
    const current = getApplicationRow(tx, applicationPublicId);
    // Another request saved it while the ref was read.
    const raced = savedPreviewOfRef(tx, current.publicId, ref!);
    if (raced) return { saved: raced, created: false };
    refuseSaving(tx, current, ref);
    const { preparation } = openPreparation(tx, repository, pinned);
    const taken = tx.select({ key: applicationPreviews.key }).from(applicationPreviews).where(eq(applicationPreviews.applicationId, current.id)).all();
    const now = new Date();
    const row = tx
      .insert(applicationPreviews)
      .values({
        publicId: generatePublicId("apv"),
        applicationId: current.id,
        key: savedPreviewKey(ref!, taken.map((other) => other.key)),
        ref: ref!,
        latestPreparationId: preparation.id,
        latestCommitSha: preparation.commitSha,
        latestRequestedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    startPackageBuild(tx, { kind: "saved", row, application: current }, preparation);
    return { saved: findSavedPreview(tx, current.publicId, row.key)!, created: true };
  });
}

/**
 * Starts an attempt at a saved preview's ref (applications/saved-previews
 * spec, "Saved branches rebuild when they move", "Saved previews can be
 * rebuilt"): pins its head again, a tag's commit too, and builds it once the
 * commit is decided. A commit already built is used as it is, unless
 * +force+. The automatic check queues its attempts at background priority
 * (design decision 3). Throws ApplicationBuildError while an attempt is
 * active, and the pinning's errors when the ref can't be read.
 */
export async function buildSavedPreview(db: Executor, publicId: string, options: BuildOptions & QueueOptions = {}): Promise<SavedPreviewRow> {
  const config = options.config ?? getConfig();
  const before = savedTarget(db, getSavedPreviewRow(db, publicId));
  refuseWhileActive(before);
  const repository = repositoryOf(db, before.application);
  assertEnrolled(db, config, repository);
  const pinned = await pinCommit(db, repository, { kind: "ref", name: before.row.ref }, { ...options, config });
  return immediate(db, (tx) => {
    const target = savedTarget(tx, getSavedPreviewRow(tx, publicId));
    refuseWhileActive(target);
    const { preparation } = openPreparation(tx, repository, pinned, { priority: options.priority });
    attach(tx, target, preparation, { force: options.force, trigger: "automatic", priority: options.priority });
    return getSavedPreviewRow(tx, publicId);
  });
}

/**
 * An operator's Rebuild preview: a new attempt at the saved branch's head, or the saved tag's commit read from the remote again, even when it was built or failed before. Unavailable while an attempt is active.
 * @public The application page's Rebuild preview uses it (task 3.1).
 */
export function rebuildSavedPreview(db: Executor, publicId: string, options: RefOptions = {}): Promise<SavedPreviewRow> {
  return buildSavedPreview(db, publicId, { ...options, force: true });
}

/** +ref+ as a qualified branch or tag, or null when it's neither. */
function qualifiedRef(ref: string): string | null {
  const match = /^refs\/(heads|tags)\/(.+)$/.exec(ref.trim());
  if (!match || !isValidGitRef(match[2]!) || /^[0-9a-f]{40}$/.test(match[2]!)) return null;
  return `refs/${match[1]}/${match[2]}`;
}

/** Throws ValidationError, on `ref`, when +application+ can't save a preview of +ref+. */
function refuseSaving(db: Executor, application: ApplicationRow, ref: string | null): void {
  if (ref === null) throw new ValidationError([{ field: "ref", message: "Choose a branch or tag" }]);
  if (ref === application.trackedRef) throw new ValidationError([{ field: "ref", message: `${branchLabel(ref)} is already the application's tracked branch.` }]);
  const saved = db.select({ n: count() }).from(applicationPreviews).where(eq(applicationPreviews.applicationId, application.id)).get()!.n;
  if (saved >= SAVED_PREVIEW_LIMIT) throw new ValidationError([{ field: "ref", message: `An application can keep ${SAVED_PREVIEW_LIMIT} previews. Remove a preview to save another.` }]);
}

/**
 * Records a new attempt at +preparation+'s commit as +target+'s latest,
 * superseding any before it, and builds its package now when the commit is
 * already decided. Only an application's attempt is written to its history.
 */
function attach(db: Executor, target: BuildTarget, preparation: PreviewPreparation, options: { force?: boolean; trigger: BuildTrigger; priority?: number }): void {
  const now = new Date();
  const values = { latestPreparationId: preparation.id, latestCommitSha: preparation.commitSha, latestPreviewId: null, latestOutcome: "building" as const, latestReasons: null, latestRequestedAt: now, updatedAt: now };
  const stale = `${targetName(target)} was changed by someone else`;
  if (target.kind === "saved") {
    startPackageBuild(db, { ...target, row: updateLocked(db, applicationPreviews, target.row, values, stale) }, preparation, options);
    return;
  }
  const attempt = updateLocked(db, applications, target.row, values, stale);
  startHistory(db, attempt, options.trigger, preparation, now);
  startPackageBuild(db, applicationTarget(attempt), preparation, options);
}

/** Records how +target+'s latest attempt stands: an application's in its history too. */
function settleTarget(db: Executor, target: BuildTarget, values: SettleValues, build?: { id: number; attempt: number }): void {
  if (target.kind === "saved") {
    settleSavedPreviews(db, eq(applicationPreviews.id, target.row.id), values);
    return;
  }
  settleApplications(db, eq(applications.id, target.row.id), values);
  settleNewestHistory(db, target.row.id, { preview: build, outcome: values.outcome, reasons: values.reasons });
}

/**
 * Starts the build of +target+'s package from the decided +preparation+, or
 * records why it can't be built. Its build and screenshot are queued at
 * +options.priority+, normal by default; a saved preview's screenshot always
 * waits behind applications' (design decision 3).
 */
export function startPackageBuild(db: Executor, target: BuildTarget, preparation: PreviewPreparation, options: { force?: boolean; priority?: number } = {}): void {
  const settle = (values: SettleValues, build?: { id: number; attempt: number }) => settleTarget(db, target, values, build);
  const { packageDir } = target.application;
  // Still profiling: the decision starts it (afterPreparationDecided).
  if (preparation.state === "profiling") return;
  if (preparation.state === "failed") {
    settle({ outcome: "failed", reasons: [{ text: preparation.failure ?? "The commit couldn't be prepared." }] });
    return;
  }
  const verdict = preparationPackages(preparation).find((candidate) => candidate.directory === packageDir);
  const facts = verdict ? packageTraits(verdict) : undefined;
  if (preparation.state === "refused" || !verdict?.qualifies) {
    settle({ outcome: "not_previewable", reasons: refusalReasons(preparation, packageDir), facts });
    return;
  }
  const queue = { priority: options.priority };
  const { preview, created } = startPreview(db, preparation.publicId, packageDir, queue);
  // A failed build of the commit is tried again; a successful one only when the operator asked to rebuild.
  const latest = !created && (preview.attemptState === "failed" || (options.force && preview.attemptState === "ready")) ? rebuildPreview(db, preview.publicId, queue) : preview;
  if (latest.attemptState === "ready") {
    settle({ outcome: "ready", latestPreview: latest.id, current: latest.id, facts }, latest);
    requestScreenshot(db, latest, target.kind === "saved" ? JOB_PRIORITIES.background : JOB_PRIORITIES.normal);
  } else {
    settle({ outcome: "building", latestPreview: latest.id, facts }, latest);
  }
}

/** Why +packageDir+ can't be built from +preparation+: each condition it failed, or why the commit was refused. */
function refusalReasons(preparation: PreviewPreparation, packageDir: string): ApplicationReason[] {
  const reason = (condition: Pick<Condition, "condition" | "reason">): ApplicationReason => ({ text: condition.reason, condition: condition.condition });
  const verdict = preparationPackages(preparation).find((candidate) => candidate.directory === packageDir);
  if (verdict) {
    const failed = verdict.conditions.filter((condition) => !condition.passed).map(reason);
    if (failed.length > 0) return failed;
  }
  const refusal = preparationRefusal(preparation);
  const general = refusal?.conditions.filter((condition) => condition.package === null).map(reason) ?? [];
  if (general.length > 0) return general;
  const where = packageDir === "." ? "the repository root" : packageDir;
  return [{ text: verdict ? (refusal?.reason ?? `The package at ${where} can't be previewed.`) : `This commit has no package at ${where}.` }];
}

function refuseWhileActive(target: ApplicationRow | BuildTarget): void {
  const [row, name] = "kind" in target ? [target.row, targetName(target)] : [target, target.name];
  if (row.latestOutcome === "building") throw new ApplicationBuildError("active", `${name} is already building. It can be rebuilt once this build finishes.`);
}

function repositoryOf(db: Executor, application: Pick<ApplicationRow, "repositoryId" | "name">): Repository {
  const repository = db.select().from(repositories).where(eq(repositories.id, application.repositoryId)).get();
  if (!repository || repository.deletedAt !== null) throw new NotFoundError(`${application.name}'s Repository was deleted`);
  return repository;
}

/** +branch+ as refs/heads/<branch>, or null when it isn't a branch name. */
export function qualifiedBranch(branch: string): string | null {
  const name = branch.trim().replace(/^refs\/heads\//, "");
  if (name === "" || name.startsWith("refs/") || !isValidGitRef(name) || /^[0-9a-f]{40}$/.test(name)) return null;
  return `refs/heads/${name}`;
}

/**
 * Onboarding's eligibility check (applications/onboarding spec, "Onboarding
 * refuses what can't be previewed"; design decision 10): pins the chosen
 * branch's head and opens that commit's preparation, which decides from the
 * commit's Profile, surveyed first when it has none, whether a package can be
 * previewed. Deciding reads the commit statically, so it needs previews on but
 * not an enrolled remote: the remote is enrolled when the operator confirms
 * trust and creates the application. Throws RefResolutionError for a branch
 * the remote doesn't have, and the acquisition errors when it can't be read.
 * @public Onboarding uses this (add-applications task 5.3).
 */
export async function prepareBranch(db: Executor, repositoryPublicId: string, branch: string, options: RefOptions = {}): Promise<PreviewPreparation> {
  const config = options.config ?? getConfig();
  if (!config.previews.enabled) throw new PreviewAccessError("disabled", "Previews are turned off");
  const repository = findRepository(db, repositoryPublicId);
  if (!repository) throw new NotFoundError(`Unknown Repository ${repositoryPublicId}`);
  const ref = qualifiedBranch(branch);
  if (ref === null) throw new NotFoundError(`${JSON.stringify(branch)} isn't a branch name`);
  const pinned = await pinCommit(db, repository, { kind: "ref", name: ref }, { ...options, config });
  // A request for the configured reference says which commit it names now (unify-surveys, design decision 4).
  if (repository.gitRef !== null && qualifiedBranch(repository.gitRef) === ref) recordConfiguredResolution(db, repository.id, pinned.commitSha, new Date());
  return openPreparation(db, repository, pinned).preparation;
}
