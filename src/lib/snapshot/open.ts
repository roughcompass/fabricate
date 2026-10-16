import { mirrorPath } from "@/lib/acquisition/mirror";
import type { AssessmentTarget, CommitSnapshot } from "@/lib/assessments/assessment-records";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { GitRunner } from "@/lib/git/runner";
import { type Budgets, SnapshotReader, type SnapshotReaderOptions } from "./reader";

/** Opens a read-only reader on a target's pinned snapshot. */
export function openSnapshot(
  target: Pick<AssessmentTarget, "sourcePublicId">,
  snapshot: Pick<CommitSnapshot, "internalRef" | "commitSha">,
  options: { config?: FabricateConfig; runner?: GitRunner; budgets?: Budgets } & SnapshotReaderOptions = {},
): Promise<SnapshotReader> {
  const config = options.config ?? getConfig();
  const runner = options.runner ?? new GitRunner({ config });
  const readerOptions = options.protectedDirectories ? { protectedDirectories: options.protectedDirectories } : {};
  return SnapshotReader.open(runner, mirrorPath(config.repositoryStorage, target.sourcePublicId), snapshot.internalRef, snapshot.commitSha, options.budgets ?? config.analysis, readerOptions);
}
