import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull, ne } from "drizzle-orm";
import { mirrorPath } from "@/lib/acquisition/mirror";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { previewBuilds, repositorySources } from "@/lib/db/schema";
import { GitError } from "@/lib/git/errors";
import { redact } from "@/lib/git/redact";
import { GitRunner } from "@/lib/git/runner";
import { isEnrolled } from "./access";
import { type PackageVerdict, selectNode } from "./eligibility";
import { cacheBytes, discardPreviewFiles, prunePreviews } from "./lifecycle";
import { OutputError, findOutputDirectory, formatBytes, validateOutput } from "./output";
import { type CommandResult, type CommandSpec, extractCommit, runCommand } from "./process";
import { type AttemptIdentity, type PreviewBuild, type PublishedArtifact, claimAttempt, failAttempt, findPreview, publishAttempt, settleAbandonedAttempts } from "./records";
import { previewPinRef } from "./refs";
import { type ClaimFiles, cacheDirectory, claimFiles, previewDirectory, publishedDirectory } from "./storage";
import { type Invocation, baseAdapter, buildArguments, buildEnvironment, cacheCleanArguments, inheritedConfigFiles, installArguments, managerCommand, previewBasePath, shimCommand, usesCorepack } from "./toolchain";

/**
 * Runs one `preview.build` job (design decisions 4, 8, and 9): one worker
 * claim of a preview's current attempt. The claim takes the attempt, then in
 * a staging directory of its own extracts the pinned commit with `git
 * archive`, picks the Node version under the current settings, installs at
 * the install root in frozen-lockfile mode, runs the package's `build`
 * script with the preview's base path, and validates the output. It
 * publishes by switching the preview's artifact pointer, only while it still
 * owns the current attempt of an undeleted, enrolled preview, so a rebuild
 * leaves the earlier artifact serving until it succeeds and a claim that lost
 * its lease can't publish over the one that took over.
 *
 * Every step is logged, with its boundary marked `==> <step>: …`, to the
 * claim's own log, which the preview records as its latest attempt's log.
 * A failure is recorded on the attempt with its reason, not retried; when
 * the lease is lost or the worker stops, the build is stopped and the job
 * runs again under a new claim.
 */

export interface BuildJob {
  preview: string;
  attempt: number;
}

export interface BuildOptions {
  /** Identifies the worker claim running the job, so that only it can publish. */
  claim: string;
  config?: FabricateConfig;
  runner?: GitRunner;
  /** Aborts when the job's lease is lost or the worker stops. */
  signal?: AbortSignal;
}

/** What one claim of an attempt did: published, failed, lost the attempt to another claim or deletion, or found nothing to do. */
export type BuildOutcome = "published" | "failed" | "superseded" | "skipped";

/** Why an attempt failed, as its reason. */
class BuildFailure extends Error {
  override name = "BuildFailure";
}

/** How much install and build output one log keeps; Fabricate's own step lines are always written. */
const LOG_LIMIT = 16 * 1024 * 1024;
/** How far before the install output may be dated, for clocks that disagree with file times. */
const CLOCK_SLACK_MS = 2_000;
const ALL = new Intl.ListFormat("en-US", { type: "conjunction" });
const ANY = new Intl.ListFormat("en-US", { type: "disjunction" });

export async function runPreviewBuild(db: Executor, job: BuildJob, options: BuildOptions): Promise<BuildOutcome> {
  const config = options.config ?? getConfig();
  // Attempts whose jobs ran out of tries end Failed rather than stay Building.
  settleAbandonedAttempts(db);
  const preview = findPreview(db, job.preview);
  if (!preview || preview.attempt !== job.attempt || (preview.attemptState !== "queued" && preview.attemptState !== "building")) return "skipped";
  const source = db.select().from(repositorySources).where(eq(repositorySources.id, preview.repositorySourceId)).get()!;
  const refuse = (reason: string): BuildOutcome => (failAttempt(db, preview.publicId, { attempt: job.attempt }, reason) ? "failed" : "skipped");
  if (!config.previews.enabled) return refuse("Previews were turned off before the build ran");
  if (!isEnrolled(config, source)) return refuse(`${source.name} is not enrolled for previews`);

  const files = claimFiles(config, preview.publicId, job.attempt, crypto.randomBytes(5).toString("hex"));
  const identity: AttemptIdentity = { attempt: job.attempt, claim: options.claim };
  let claimed: PreviewBuild | null = null;
  let log: AttemptLog;
  try {
    await fsp.mkdir(path.dirname(files.log), { recursive: true });
    claimed = claimAttempt(db, preview.publicId, job.attempt, options.claim, files.logName);
    if (!claimed) return "skipped";
    await sweep(config, claimed, files);
    log = await AttemptLog.open(files.log);
  } catch (error) {
    // Without storage the attempt can't run anywhere; retrying the job wouldn't help.
    const reason = `The build couldn't start in ${config.previews.storage}: ${error instanceof Error ? error.message : String(error)}`;
    return failAttempt(db, preview.publicId, claimed ? identity : { attempt: job.attempt }, reason) ? "failed" : "skipped";
  }
  try {
    const own = claimed.id;
    const othersBuilding = () => otherBuildRunning(db, own);
    const artifact = await build({ config, preview: claimed, sourcePublicId: source.publicId, files, log, runner: options.runner, signal: options.signal, othersBuilding });
    log.step("publish", artifact.directory);
    await fsp.mkdir(path.dirname(files.artifact), { recursive: true });
    await fsp.rename(files.output, files.artifact);
    const published = publish(db, config, claimed.publicId, identity, artifact);
    if (published.state !== "published") {
      await fsp.rm(files.artifact, { recursive: true, force: true });
      log.step("not published", published.state === "revoked" ? published.reason : "This claim no longer runs the preview's current attempt.");
      return published.state === "revoked" ? "failed" : "superseded";
    }
    // The superseded artifact is no longer served.
    const superseded = publishedDirectory(config, { publicId: claimed.publicId, artifact: published.superseded });
    if (superseded) await fsp.rm(superseded, { recursive: true, force: true });
    // Keep every preview's stored output under the limit, never deleting this one; a failed prune is retried after the next build.
    const pruned = await prunePreviews(db, config, { keep: claimed.publicId }).catch(() => null);
    if (pruned?.deleted.length) {
      log.step("prune", `deleted ${pruned.deleted.length === 1 ? "the least recently used preview" : `the ${pruned.deleted.length} least recently used previews`} to keep stored output under ${formatBytes(pruned.limit)}: ${pruned.deleted.join(", ")}`);
    }
    log.step("ready", `${artifact.outputBytes} bytes published in ${Math.round(artifact.buildMs / 1_000)}s`);
    return "published";
  } catch (error) {
    if (options.signal?.aborted) {
      log.step("stopped", String((options.signal.reason as Error | undefined)?.message ?? "The job was stopped"));
      throw error;
    }
    const reason = error instanceof BuildFailure ? error.message : `The build stopped unexpectedly: ${redact(error instanceof Error ? error.message : String(error))}`;
    log.step("failed", reason);
    await log.close();
    return failAttempt(db, claimed.publicId, identity, reason) ? "failed" : "superseded";
  } finally {
    await log.close();
    await fsp.rm(files.staging, { recursive: true, force: true });
    // A preview deleted while this claim ran owns nothing, so whatever its build wrote at the preview's path since goes too.
    if (!findPreview(db, claimed.publicId)) await discardPreviewFiles(config, [claimed.publicId]);
  }
}

interface BuildContext {
  config: FabricateConfig;
  preview: PreviewBuild;
  sourcePublicId: string;
  files: ClaimFiles;
  log: AttemptLog;
  runner?: GitRunner;
  signal?: AbortSignal;
  /** Whether another preview is building, whose install pruning the caches could break. */
  othersBuilding: () => boolean;
}

/** Extracts, installs, builds, and validates; returns the artifact to publish, moved to files.output. */
async function build(context: BuildContext): Promise<PublishedArtifact> {
  const { config, preview, files, log, signal } = context;
  const started = Date.now();
  const deadline = started + config.previews.timeoutMinutes * 60_000;
  const limit = `Build exceeded ${config.previews.timeoutMinutes} ${config.previews.timeoutMinutes === 1 ? "minute" : "minutes"}`;
  const verdict = JSON.parse(preview.decidingFacts) as PackageVerdict;
  const plan = verdict.plan;
  if (!plan) throw new BuildFailure(`${preview.packageDir} has no build plan`);
  log.line(`Preview ${preview.publicId}, attempt ${preview.attempt}: ${preview.packageDir} at ${preview.commitSha}${preview.refName ? ` (${preview.refName})` : ""}`);

  // 1. Extract the pinned commit. No checkout, hook, filter, or submodule runs.
  log.step("extract", `git archive ${preview.commitSha}`);
  const gitDir = mirrorPath(config.repositoryStorage, context.sourcePublicId);
  const runner = context.runner ?? new GitRunner({ config, timeoutMs: Math.max(1, deadline - Date.now()) });
  for (const directory of [files.work, files.home, files.tmp]) await fsp.mkdir(directory, { recursive: true });
  try {
    if ((await runner.revParse(gitDir, `${previewPinRef(preview.commitSha)}^{commit}`)) !== preview.commitSha) {
      throw new BuildFailure(`The commit ${preview.commitSha.slice(0, 12)} is no longer pinned in the Repository's clone. Prepare it again.`);
    }
    await extractCommit(runner, gitDir, preview.commitSha, files.work, signal);
  } catch (error) {
    if (error instanceof GitError && error.code === "timeout") throw new BuildFailure(limit);
    if (error instanceof BuildFailure || signal?.aborted) throw error;
    throw new BuildFailure(`The commit couldn't be extracted: ${redact(error instanceof Error ? error.message : String(error))}`);
  }

  // 2. Choose Node again, under the settings the build runs with.
  const selected = selectNode(Object.keys(config.previews.nodeVersions), plan.node.ranges);
  if (selected.version === null) throw new BuildFailure(selected.reason);
  const nodeBin = config.previews.nodeVersions[selected.version]!;
  if (!fs.existsSync(path.join(nodeBin, "node"))) throw new BuildFailure(`Node ${selected.version} is configured at ${nodeBin}, which has no node executable.`);
  log.line(`${selected.reason}, from ${nodeBin}.`);

  const manager = plan.packageManager;
  const installRoot = path.join(files.work, ...segments(plan.installRoot));
  const packageDir = path.join(files.work, ...segments(preview.packageDir));
  const base = previewBasePath(preview.publicId);
  const adapter = baseAdapter(plan.buildTool, base);
  const shims = usesCorepack(manager) ? files.shims : null;
  const environment = (step: "install" | "build") => buildEnvironment({ manager, nodeBin, shims, home: files.home, tmp: files.tmp, cache: cacheDirectory(config), step, base: adapter.env });
  const run = async (invocation: Invocation, cwd: string, env: Record<string, string>, label: string) => {
    const spec: CommandSpec = { command: invocation.command, args: invocation.args, cwd, env, output: log.output, deadline, signal };
    const result = await runCommand(spec);
    if (result.outcome === "timed_out") throw new BuildFailure(limit);
    if (result.outcome === "aborted") throw (signal?.reason as Error | undefined) ?? new Error("The build was stopped");
    if (result.code !== 0) throw new BuildFailure(`${label} failed: ${display(invocation)} ${result.code === null ? `was stopped by ${result.signal}` : `exited with code ${result.code}`}.`);
  };

  // 3. Install at the install root, from the lockfile, without changing it.
  const command = managerCommand(manager, nodeBin);
  const install = { command: command.command, args: [...command.args, ...installArguments(manager)] };
  log.step("install", `${display(install)} in ${place(plan.installRoot)}, with ${manager.lockfile}`);
  // Yarn would read configuration above the extracted commit, which isn't the repository's; the build's own HOME can't stop it.
  const names = inheritedConfigFiles(manager);
  const inherited = await configurationAbove(files.work, names);
  if (inherited.length > 0) {
    throw new BuildFailure(`Yarn reads configuration from every directory above the one it installs in, so it would read ${ALL.format(inherited)}. Set previews.storage to a directory with no ${ANY.format(names)} above it.`);
  }
  const installed = Date.now() - CLOCK_SLACK_MS;
  if (shims) {
    if (!fs.existsSync(path.join(nodeBin, "corepack"))) throw new BuildFailure(`Node ${selected.version} at ${nodeBin} has no corepack, which ${manager.name} needs.`);
    await fsp.mkdir(shims, { recursive: true });
    await run(shimCommand(manager, nodeBin, shims), files.home, environment("install"), "Installing corepack's shims");
  }
  await run(install, installRoot, environment("install"), "The install");

  // 4. Run the package's own build script with the preview's base path.
  const buildCommand = { command: command.command, args: [...command.args, ...buildArguments(manager, adapter.args)] };
  log.step("build", `${display(buildCommand)} in ${place(preview.packageDir)}${Object.keys(adapter.env).length ? `, with ${Object.keys(adapter.env).join(" and ")} set to ${base}` : ""}`);
  await run(buildCommand, packageDir, environment("build"), "The build");

  // 5. Identify and validate the output, then delete the working tree.
  try {
    const directory = await findOutputDirectory(packageDir, plan.buildTool, installed);
    log.step("validate", path.posix.join(preview.packageDir, directory));
    await fsp.rename(path.join(packageDir, ...segments(directory)), files.output);
    await fsp.rm(files.work, { recursive: true, force: true });
    const output = await validateOutput(files.output, { base, maxBytes: config.previews.maxOutputBytes });
    log.line(`${output.files} files, ${output.bytes} bytes. Page ${output.entry.file}${output.entry.rebase ? ", which refers to assets at the site root, outside the preview's base path" : ""}.`);
    await pruneCache(context, { command: { command: command.command, args: [...command.args, ...cacheCleanArguments(manager)] }, env: environment("install"), deadline });
    return {
      directory: files.artifactName,
      // Every published artifact is a page of its own, whatever kind of package built it (design decision 7).
      layout: "standalone",
      entry: output.entry,
      outputBytes: output.bytes,
      buildMs: Date.now() - started,
      nodeVersion: selected.version,
      packageManager: manager.version ? `${manager.name}@${manager.version}` : manager.name,
    };
  } catch (error) {
    if (error instanceof OutputError) throw new BuildFailure(error.message);
    throw error;
  }
}

/** Whether a preview other than the one with row id +own+ is building, once abandoned attempts are settled. */
function otherBuildRunning(db: Executor, own: number): boolean {
  settleAbandonedAttempts(db);
  return db
    .select({ id: previewBuilds.id })
    .from(previewBuilds)
    .where(and(eq(previewBuilds.attemptState, "building"), isNull(previewBuilds.deletedAt), ne(previewBuilds.id, own)))
    .get() !== undefined;
}

/** How long the package manager's cache command may run. */
const CACHE_CLEAN_MS = 5 * 60_000;

/**
 * Empties this build's package manager cache with the manager's own command
 * (design decision 8) when the caches every build shares hold more than half
 * of `previews.maxStorageBytes`, unless another build is running, whose
 * install it could break. Runs with the build's Node, manager version, and
 * environment. Never fails the build.
 */
async function pruneCache(context: BuildContext, clean: { command: Invocation; env: Record<string, string>; deadline: number }): Promise<void> {
  const { config, files, log, signal } = context;
  const held = await cacheBytes(config);
  if (held * 2 <= config.previews.maxStorageBytes) return;
  const holding = `the package caches hold ${formatBytes(held)}, more than half of previews.maxStorageBytes`;
  if (context.othersBuilding()) {
    log.step("cache", `${holding}; another build is running, so a later build prunes them`);
    return;
  }
  log.step("cache", `${holding}: ${display(clean.command)}`);
  let result: CommandResult;
  try {
    result = await runCommand({ ...clean.command, cwd: files.home, env: clean.env, output: log.output, deadline: Math.min(clean.deadline, Date.now() + CACHE_CLEAN_MS), signal });
  } catch (error) {
    log.line(`The caches weren't pruned: ${error instanceof Error ? error.message : String(error)}.`);
    return;
  }
  if (result.outcome === "aborted") throw (signal?.reason as Error | undefined) ?? new Error("The build was stopped");
  if (result.outcome === "exited" && result.code === 0) log.line(`The package caches now hold ${formatBytes(await cacheBytes(config))}.`);
  else log.line(`The caches weren't pruned: ${display(clean.command)} ${result.outcome === "timed_out" ? "ran out of time" : result.code === null ? `was stopped by ${result.signal}` : `exited with code ${result.code}`}.`);
}

type Publication = { state: "published"; superseded: string | null } | { state: "revoked"; reason: string } | { state: "not_current" };

/**
 * Switches the preview's artifact pointer to +artifact+, in one transaction
 * with the checks that allow it: previews are on, the Repository is still
 * enrolled, and +identity+ still owns the current attempt of the undeleted
 * preview. When enrollment was revoked, the attempt fails instead.
 */
function publish(db: Executor, config: FabricateConfig, publicId: string, identity: AttemptIdentity, artifact: PublishedArtifact): Publication {
  return immediate(db, (tx) => {
    const current = findPreview(tx, publicId);
    if (!current) return { state: "not_current" };
    const source = tx.select().from(repositorySources).where(eq(repositorySources.id, current.repositorySourceId)).get()!;
    if (!isEnrolled(config, source)) {
      const reason = config.previews.enabled ? `${source.name} is no longer enrolled for previews, so the output wasn't published` : "Previews were turned off before the output was published";
      return failAttempt(tx, publicId, identity, reason) ? { state: "revoked", reason } : { state: "not_current" };
    }
    return publishAttempt(tx, publicId, identity, artifact) ? { state: "published", superseded: current.artifact } : { state: "not_current" };
  });
}

/**
 * Removes what earlier attempts left: every log but this claim's, since only
 * the latest attempt's log is kept, and the staging and unpublished output of
 * earlier attempts, which can no longer publish. Other claims of this attempt
 * clean up after themselves.
 */
async function sweep(config: FabricateConfig, preview: PreviewBuild, files: ClaimFiles): Promise<void> {
  const root = previewDirectory(config, preview.publicId);
  const earlier = (name: string) => Number(name.split("-")[0]) < preview.attempt;
  const remove = async (directory: string, keep: (name: string) => boolean) => {
    const names = await fsp.readdir(path.join(root, directory)).catch(() => [] as string[]);
    await Promise.all(names.filter((name) => !keep(name)).map((name) => fsp.rm(path.join(root, directory, name), { recursive: true, force: true })));
  };
  await remove("logs", (name) => `logs/${name}` === files.logName);
  await remove("staging", (name) => !earlier(name));
  await remove("out", (name) => !earlier(name) || `out/${name}` === preview.artifact);
}

/** A claim's log: install and build output up to LOG_LIMIT, and Fabricate's own lines, which are always kept. */
class AttemptLog {
  private written = 0;
  private truncated = false;
  private newline = true;
  private closed: Promise<void> | null = null;

  private constructor(private readonly stream: fs.WriteStream) {
    // Losing the log never stops the build.
    stream.on("error", () => {});
  }

  static async open(file: string): Promise<AttemptLog> {
    const stream = fs.createWriteStream(file, { flags: "a" });
    await new Promise<void>((resolve, reject) => {
      stream.once("open", () => resolve());
      stream.once("error", reject);
    });
    return new AttemptLog(stream);
  }

  readonly output = (chunk: Buffer): void => {
    if (this.truncated || this.closed) return;
    const room = LOG_LIMIT - this.written;
    if (chunk.length > room) {
      this.truncated = true;
      this.write(chunk.subarray(0, room));
      this.line(`[The output is longer than ${LOG_LIMIT / 1024 / 1024} MiB; the rest is left out of this log.]`);
      return;
    }
    this.written += chunk.length;
    this.write(chunk);
  };

  line(text: string): void {
    if (this.closed) return;
    this.write(`${this.newline ? "" : "\n"}${text}\n`);
  }

  step(name: string, detail: string): void {
    this.line(`==> ${name}: ${detail}`);
  }

  close(): Promise<void> {
    return (this.closed ??= new Promise<void>((resolve) => this.stream.end(() => resolve())));
  }

  private write(data: Buffer | string): void {
    if (data.length === 0) return;
    this.stream.write(data);
    this.newline = (typeof data === "string" ? data.at(-1) : String.fromCharCode(data[data.length - 1]!)) === "\n";
  }
}

/** A command as the log shows it: the executable's name, not its path. */
function display(invocation: Invocation): string {
  return [path.basename(invocation.command), ...invocation.args].join(" ");
}

function place(directory: string): string {
  return directory === "." ? "the repository root" : directory;
}

function segments(directory: string): string[] {
  return directory === "." ? [] : directory.split("/");
}

/** Each file named +names+ in a directory above +directory+, by its real path, nearest first. */
async function configurationAbove(directory: string, names: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  if (names.length === 0) return found;
  // A package manager walks up from its working directory's real path.
  for (let current = path.dirname(await fsp.realpath(directory)); ; current = path.dirname(current)) {
    for (const name of names) {
      const file = path.join(current, name);
      if (fs.existsSync(file)) found.push(file);
    }
    if (path.dirname(current) === current) return found;
  }
}
