import { eq } from "drizzle-orm";
import { type Repository, isValidGitRef } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError, StaleRecordError, ValidationError, isUniqueViolation } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { applications, previewPreparations, repositories } from "@/lib/db/schema";
import { updateLocked } from "@/lib/db/optimistic";
import { assertEnrolled } from "@/lib/previews/access";
import { type Condition, packageTraits } from "@/lib/previews/eligibility";
import { type PreviewPreparation, openPreparation, preparationPackages, preparationRefusal, rebuildPreview, startPreview } from "@/lib/previews/records";
import { requestScreenshot } from "@/lib/previews/screenshots";
import { type RefOptions, pinCommit } from "@/lib/previews/refs";
import { type ApplicationReason, type ApplicationRow, applicationOfPackage, checkDetails, getApplicationRow, nameKey, normalizeDetails, settleApplications, slugFor } from "./records";

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
 */

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
}

/**
 * Records an application and starts its first build, from the decided
 * preparation of its tracked branch's commit, in one transaction. Throws
 * ValidationError for its name and description, a package that doesn't
 * qualify or is already an application, or a preparation that isn't the
 * Repository's or isn't decided; and PreviewAccessError while previews are
 * off or the Repository isn't enrolled.
 * @public The Applications pages and their actions use this (add-applications tasks 5 to 8).
 */
export function createApplication(db: Executor, input: CreateApplicationInput, config: FrontendRegistryConfig = getConfig()): ApplicationRow {
  return immediate(db, (tx) => {
    const repository = tx.select().from(repositories).where(eq(repositories.publicId, input.repository)).get();
    if (!repository || repository.deletedAt !== null) throw new NotFoundError(`Unknown Repository ${input.repository}`);
    assertEnrolled(config, repository);
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
    startPackageBuild(tx, application, preparation!);
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
 * @public The automatic check uses this (add-applications task 3.1).
 */
export async function buildApplication(db: Executor, publicId: string, options: BuildOptions = {}): Promise<ApplicationRow> {
  const config = options.config ?? getConfig();
  const before = getApplicationRow(db, publicId);
  refuseWhileActive(before);
  const repository = repositoryOf(db, before);
  assertEnrolled(config, repository);
  const pinned = await pinCommit(db, repository, { kind: "ref", name: before.trackedRef }, { ...options, config });
  return immediate(db, (tx) => {
    const application = getApplicationRow(tx, publicId);
    // Another request started an attempt while the branch was read.
    refuseWhileActive(application);
    const { preparation } = openPreparation(tx, repository, pinned);
    return attach(tx, application, preparation, options);
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
 * stays in use until the new branch's build succeeds.
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
  if (moved) assertEnrolled(config, repository);
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
    return attach(tx, updated, openPreparation(tx, repository, pinned).preparation, {});
  });
}

/**
 * Records a new attempt at +preparation+'s commit as the application's
 * latest, superseding any before it, and builds its package now when the
 * commit is already decided.
 */
function attach(db: Executor, application: ApplicationRow, preparation: PreviewPreparation, options: { force?: boolean }): ApplicationRow {
  const now = new Date();
  const attempt = updateLocked(
    db,
    applications,
    application,
    { latestPreparationId: preparation.id, latestCommitSha: preparation.commitSha, latestPreviewId: null, latestOutcome: "building", latestReasons: null, latestRequestedAt: now, updatedAt: now },
    `${application.name} was changed by someone else`,
  );
  startPackageBuild(db, attempt, preparation, options);
  return getApplicationRow(db, application.publicId);
}

/** Starts the build of +application+'s package from the decided +preparation+, or records why it can't be built. */
export function startPackageBuild(db: Executor, application: ApplicationRow, preparation: PreviewPreparation, options: { force?: boolean } = {}): void {
  const own = eq(applications.id, application.id);
  // Still profiling: the decision starts it (afterPreparationDecided).
  if (preparation.state === "profiling") return;
  if (preparation.state === "failed") {
    settleApplications(db, own, { outcome: "failed", reasons: [{ text: preparation.failure ?? "The commit couldn't be prepared." }] });
    return;
  }
  const verdict = preparationPackages(preparation).find((candidate) => candidate.directory === application.packageDir);
  const facts = verdict ? packageTraits(verdict) : undefined;
  if (preparation.state === "refused" || !verdict?.qualifies) {
    settleApplications(db, own, { outcome: "not_previewable", reasons: refusalReasons(preparation, application.packageDir), facts });
    return;
  }
  const { preview, created } = startPreview(db, preparation.publicId, application.packageDir);
  // A failed build of the commit is tried again; a successful one only when the operator asked to rebuild.
  const latest = !created && (preview.attemptState === "failed" || (options.force && preview.attemptState === "ready")) ? rebuildPreview(db, preview.publicId) : preview;
  if (latest.attemptState === "ready") {
    settleApplications(db, own, { outcome: "ready", latestPreview: latest.id, current: latest.id, facts });
    requestScreenshot(db, latest);
  } else {
    settleApplications(db, own, { outcome: "building", latestPreview: latest.id, facts });
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

function refuseWhileActive(application: ApplicationRow): void {
  if (application.latestOutcome === "building") throw new ApplicationBuildError("active", `${application.name} is already building. It can be rebuilt once this build finishes.`);
}

function repositoryOf(db: Executor, application: ApplicationRow): Repository {
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
