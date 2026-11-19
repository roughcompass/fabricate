import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { resolveReference } from "@/lib/acquisition/acquire";
import { currentRecipe, moveSurvey, requestSurvey } from "@/lib/surveys/records";
import { pinSurveyCommit } from "@/lib/surveys/run";
import type { RunTarget } from "@/lib/runs/run-records";
import { transitionTarget } from "@/lib/runs/transitions";
import { resolveCloneUrl } from "@/lib/repositories/registration";
import { SourceBoundary } from "@/lib/repositories/source-boundary";
import { type Repository, insertRepository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { GitRunner } from "@/lib/git/runner";
import { buildRun } from "./builders";
import { createTestDb } from "./db";
import { GitFixture } from "./git-fixture";

/** Configuration whose allowed root is a fixture and whose storage is private. */
export function acquisitionConfig(fixture: GitFixture, overrides: Parameters<typeof withOverrides>[1] = {}): FrontendRegistryConfig {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "acquire-storage-"));
  return withOverrides(getConfig(), { allowedRoots: [fixture.root], repositoryStorage: fs.realpathSync(storage), ...overrides });
}

export interface AcquisitionWorld {
  /** The Git fixture whose root is the only allowed one. */
  fixture: GitFixture;
  /** Configuration that allows the fixture, with private repository storage. */
  config: FrontendRegistryConfig;
  db: Db;
}

/**
 * Registers hooks that give each test, or with `once` the whole suite, a Git
 * fixture, a configuration that allows it, and a fresh database, and that
 * remove the fixture and storage afterward. Read them from the returned world
 * inside hooks and tests; the suite's own hooks run after it sets up and
 * before it cleans up.
 */
export function useAcquisitionWorld(name: string, options: { overrides?: Parameters<typeof withOverrides>[1]; once?: boolean } = {}): AcquisitionWorld {
  const world = {} as AcquisitionWorld;
  (options.once ? beforeAll : beforeEach)(() => {
    world.fixture = GitFixture.create(name);
    world.config = acquisitionConfig(world.fixture, options.overrides);
    world.db = createTestDb();
  });
  (options.once ? afterAll : afterEach)(() => {
    world.fixture.cleanup();
    fs.rmSync(world.config.repositoryStorage, { recursive: true, force: true });
  });
  return world;
}

export function registerLocalRepository(db: Db, config: FrontendRegistryConfig, name: string, location: string, gitRef: string | null = null): Repository {
  const url = resolveCloneUrl(`file://${location}`, new SourceBoundary(config));
  return insertRepository(db, { name, ...url, gitRef });
}

/** A new Assessment over +source+ with its target moved to acquiring. */
export function acquiringTarget(db: Db, repository: Repository): RunTarget {
  const { targets } = buildRun(db, { repositories: [repository] });
  return transitionTarget(db, targets[0]!, "acquiring");
}

/**
 * Resolves +source+'s reference and pins its commit for a survey, as the
 * survey job does, without surveying it. Returns the survey, and the pin as
 * readers open it.
 */
export async function acquire(db: Db, config: FrontendRegistryConfig, repository: Repository, options: { runner?: GitRunner; signal?: AbortSignal } = {}) {
  const runner = options.runner ?? new GitRunner({ config });
  const resolution = await resolveReference({ repositoryPublicId: repository.publicId, cloneUrl: repository.cloneUrl, gitRef: repository.gitRef }, { config, runner, ...(options.signal && { signal: options.signal }) });
  const { survey } = requestSurvey(db, { repositoryId: repository.id, commitSha: resolution.commitSha, reference: resolution.name, fromConfiguredReference: true, trigger: "manual", ...currentRecipe(config) });
  const running = survey.state === "queued" ? moveSurvey(db, survey, "running", { attempts: survey.attempts + 1 }) : survey;
  const pinned = await pinSurveyCommit(db, running, repository, { config, runner, boundary: new SourceBoundary(config), ...(options.signal && { signal: options.signal }) });
  return { survey: pinned, resolution, target: { repositoryPublicId: repository.publicId }, snapshot: { publicId: pinned.publicId, commitSha: pinned.commitSha, treeSha: pinned.treeSha!, internalRef: pinned.internalRef!, refKind: resolution.kind, resolvedRef: resolution.name } };
}
