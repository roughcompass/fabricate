import { mirrorPath } from "@/lib/acquisition/mirror";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { GitRunner } from "@/lib/git/runner";
import { type Budgets, SnapshotReader, type SnapshotReaderOptions } from "./reader";

/** Opens a read-only reader on a Repository's pinned commit: a survey's, or a preview's. */
export function openSnapshot(
  target: { repositoryPublicId: string },
  snapshot: { internalRef: string; commitSha: string },
  options: { config?: FrontendRegistryConfig; runner?: GitRunner; budgets?: Budgets } & SnapshotReaderOptions = {},
): Promise<SnapshotReader> {
  const config = options.config ?? getConfig();
  const runner = options.runner ?? new GitRunner({ config });
  const readerOptions = options.protectedDirectories ? { protectedDirectories: options.protectedDirectories } : {};
  return SnapshotReader.open(runner, mirrorPath(config.repositoryStorage, target.repositoryPublicId), snapshot.internalRef, snapshot.commitSha, options.budgets ?? config.analysis, readerOptions);
}
