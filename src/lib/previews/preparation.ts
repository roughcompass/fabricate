import { eq } from "drizzle-orm";
import { DETECTOR_RELEASE, analyze, detectorConfiguration } from "@repo-facts/bundle";
import type { JsonObject } from "@repo-facts/contract";
import { mirrorPath } from "@/lib/acquisition/mirror";
import { type RepositorySource, getSource } from "@/lib/catalog/source-records";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { repositoryProfiles, repositorySources } from "@/lib/db/schema";
import { prepareDocument, readDocument } from "@/lib/documents/digested";
import { redact } from "@/lib/git/redact";
import { GitRunner } from "@/lib/git/runner";
import { buildProfile, profileProblems } from "@/lib/profiles/schema";
import type { FactDocument } from "@/lib/profiles/states";
import { currentVersion } from "@/lib/profiling/versions";
import { SnapshotReader } from "@/lib/snapshot/reader";
import { assertEnrolled, isEnrolled } from "./access";
import { type ManifestRead, type PageRead, evaluateEligibility, installRootManifests, manifestPath, readPage, viteConfig, vitePackages } from "./eligibility";
import { type PreparationProfile, type PreviewPreparation, decidePreparation, failPreparation, findPreparation, openPreparation, startPreview } from "./records";
import { type RefOptions, type RefRequest, pinCommit, previewPinRef } from "./refs";

/**
 * Prepares a pinned commit for previews before any build exists (design
 * decision 3). A request checks the feature switch and the Repository's
 * enrollment, pins the commit, and queues a `preview.prepare` job. The job
 * decides from the Repository's newest Profile when it's of this commit, or
 * else runs the same detector bundle statically through the snapshot reader
 * at the pin, with the configured analysis budgets, keeping the document with
 * the preparation. It never creates a profile version or touches an
 * assessment. It then reads the install roots' committed manifests, and looks
 * for each Vite package's committed page, through the same reader, evaluates
 * every package, and, when exactly one qualifies, starts its preview.
 */

/** Pins +request+ for the Repository +sourcePublicId+ and returns its preparation, queued or as it stands. */
export async function requestPreparation(db: Executor, sourcePublicId: string, request: RefRequest, options: RefOptions = {}): Promise<PreviewPreparation> {
  const config = options.config ?? getConfig();
  const source = getSource(db, sourcePublicId);
  assertEnrolled(config, source);
  const pinned = await pinCommit(db, source, request, { ...options, config });
  return openPreparation(db, source, pinned).preparation;
}

export interface PreparationJob {
  preparation: string;
  /** When the preparation was requested, so a job for an earlier request changes nothing. */
  requested: number;
}

/**
 * Runs one `preview.prepare` job. Returns the preparation as decided or
 * failed, or null when it no longer awaits this job. A failure is recorded on
 * the preparation rather than retried, except when the job's lease was lost
 * or the worker is stopping.
 */
export async function runPreparation(db: Executor, job: PreparationJob, options: { config?: FabricateConfig; runner?: GitRunner; signal?: AbortSignal } = {}): Promise<PreviewPreparation | null> {
  const config = options.config ?? getConfig();
  const preparation = findPreparation(db, job.preparation);
  if (!preparation || preparation.state !== "profiling" || preparation.requestedAt.getTime() !== job.requested) return null;
  const source = db.select().from(repositorySources).where(eq(repositorySources.id, preparation.repositorySourceId)).get()!;
  if (!config.previews.enabled) return failPreparation(db, job.preparation, job.requested, "Previews were turned off before the commit was prepared");
  if (!isEnrolled(config, source)) return failPreparation(db, job.preparation, job.requested, `${source.name} is not enrolled for previews`);

  try {
    const runner = options.runner ?? new GitRunner({ config });
    const gitDir = mirrorPath(config.repositoryStorage, source.publicId);
    const open = () => SnapshotReader.open(runner, gitDir, previewPinRef(preparation.commitSha), preparation.commitSha, config.analysis);
    const { profile, document } = await profileOf(db, source, preparation, config, open, options.signal);
    const facts = document.fact_document as unknown as FactDocument;
    const reader = await open();
    const manifests = await readManifests(reader, installRootManifests(facts));
    const pages = await readPages(reader, vitePackages(facts));
    const eligibility = evaluateEligibility({ document: facts, manifests, nodeVersions: Object.keys(config.previews.nodeVersions), pages });
    return immediate(db, (tx) => {
      const decided = decidePreparation(tx, job.preparation, job.requested, profile, eligibility);
      // With exactly one qualifying package there's nothing to choose.
      const qualifying = eligibility.packages.filter((verdict) => verdict.qualifies);
      if (decided?.state === "ready" && qualifying.length === 1) startPreview(tx, decided.publicId, qualifying[0]!.directory);
      return decided;
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return failPreparation(db, job.preparation, job.requested, redact(error instanceof Error ? error.message : String(error)));
  }
}

/**
 * The Profile to decide from: the Repository's newest Profile when it's of
 * this commit, else one this preparation made earlier with the same detector
 * release and configuration, else a new static detector run at the pin.
 */
async function profileOf(
  db: Executor,
  source: RepositorySource,
  preparation: PreviewPreparation,
  config: FabricateConfig,
  open: () => Promise<SnapshotReader>,
  signal?: AbortSignal,
): Promise<{ profile: PreparationProfile; document: JsonObject }> {
  const version = currentVersion(db, source.id);
  if (version?.profile && version.commit === preparation.commitSha) {
    const stored = db.select().from(repositoryProfiles).where(eq(repositoryProfiles.id, version.profile.id)).get();
    if (!stored) throw new NotFoundError(`Repository Profile ${version.profile.publicId} does not exist`);
    return { profile: { repositoryProfileId: stored.id, digest: stored.digest }, document: readDocument("repositoryProfile", stored, `Repository Profile ${stored.publicId}`) };
  }

  const { digest: configurationDigest } = detectorConfiguration(config.analysis);
  if (preparation.profileDocument !== null && preparation.profileDigest !== null) {
    const kept = readDocument("repositoryProfile", { document: preparation.profileDocument, digest: preparation.profileDigest }, `The Profile of preparation ${preparation.publicId}`);
    if (kept.detector_release === DETECTOR_RELEASE && kept.detector_configuration_digest === configurationDigest) return { profile: { document: preparation.profileDocument, digest: preparation.profileDigest }, document: kept };
  }

  const factDocument = await analyze(await open(), signal ? { signal } : {});
  const prepared = prepareDocument(
    "repositoryProfile",
    buildProfile({
      source: { public_id: source.publicId, name: source.name, clone_url: source.cloneUrl, git_ref: source.gitRef },
      commit: preparation.commitSha,
      detectorRelease: DETECTOR_RELEASE,
      configurationDigest,
      factDocument,
    }),
  );
  const problems = profileProblems(prepared.value);
  if (problems.length) throw new Error(`The commit's Profile is not valid: ${problems.join("; ")}`);
  return { profile: { document: prepared.text, digest: prepared.digest }, document: prepared.value };
}

/** The committed package.json of each of +directories+, read through +reader+. */
async function readManifests(reader: SnapshotReader, directories: readonly string[]): Promise<Map<string, ManifestRead>> {
  const results = await reader.readMany(directories.map(manifestPath));
  return new Map(
    directories.map((directory): [string, ManifestRead] => {
      const result = results.get(manifestPath(directory));
      if (!result) return [directory, { state: "unreadable", reason: "it wasn't read" }];
      if (!result.ok) return [directory, result.skip.reason === "missing" ? { state: "missing" } : { state: "unreadable", reason: result.skip.reason }];
      try {
        const manifest: unknown = JSON.parse(result.content.text ?? "");
        if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) return [directory, { state: "read", manifest: manifest as JsonObject }];
        return [directory, { state: "unreadable", reason: "it isn't a JSON object" }];
      } catch {
        return [directory, { state: "unreadable", reason: "it isn't valid JSON" }];
      }
    }),
  );
}

/**
 * Each of +directories+' Vite page, through +reader+: whether index.html is
 * committed at the root its build reads, reading only the configuration that
 * may name that root.
 */
async function readPages(reader: SnapshotReader, directories: readonly string[]): Promise<Map<string, PageRead>> {
  const has = (file: string) => reader.entry(file) !== undefined;
  const configs = await reader.readMany(directories.flatMap((directory) => viteConfig(directory, { has }) ?? []));
  const text = (file: string) => {
    const result = configs.get(file);
    return result?.ok ? result.content.text : null;
  };
  return new Map(directories.map((directory) => [directory, readPage(directory, { has, text })]));
}
