import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireSnapshot } from "@/lib/acquisition/acquire";
import type { AssessmentTarget } from "@/lib/assessments/assessment-records";
import { transitionTarget } from "@/lib/assessments/transitions";
import { resolveCloneUrl } from "@/lib/catalog/catalog";
import { SourceBoundary } from "@/lib/catalog/source-boundary";
import { type RepositorySource, insertSource } from "@/lib/catalog/source-records";
import { type FabricateConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { GitRunner } from "@/lib/git/runner";
import { buildAssessment } from "./builders";
import type { GitFixture } from "./git-fixture";

/** Configuration whose allowed root is a fixture and whose storage is private. */
export function acquisitionConfig(fixture: GitFixture, overrides: Parameters<typeof withOverrides>[1] = {}): FabricateConfig {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "acquire-storage-"));
  return withOverrides(getConfig(), { allowedRoots: [fixture.root], repositoryStorage: fs.realpathSync(storage), ...overrides });
}

export function registerLocalSource(db: Db, config: FabricateConfig, name: string, location: string, gitRef: string | null = null): RepositorySource {
  const url = resolveCloneUrl(`file://${location}`, new SourceBoundary(config));
  return insertSource(db, { name, ...url, gitRef });
}

/** A new Assessment over +source+ with its target moved to acquiring. */
export function acquiringTarget(db: Db, source: RepositorySource): AssessmentTarget {
  const { targets } = buildAssessment(db, { sources: [source] });
  return transitionTarget(db, targets[0]!, "acquiring");
}

export async function acquire(db: Db, config: FabricateConfig, source: RepositorySource, options: { runner?: GitRunner; signal?: AbortSignal } = {}) {
  const { assessment, targets } = buildAssessment(db, { sources: [source], limits: config.analysis });
  const target = transitionTarget(db, targets[0]!, "acquiring");
  return { assessment, target, snapshot: await acquireSnapshot(db, target, { config, runner: options.runner, signal: options.signal }) };
}
