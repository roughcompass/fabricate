import type { RepositorySource } from "@/lib/catalog/source-records";
import { SourceBoundary } from "@/lib/catalog/source-boundary";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { GitRunner } from "@/lib/git/runner";
import { gitSource, normalizeAcquisitionError } from "./acquire";
import { advertisedCommit, parseLsRemote, resolveAdvertised } from "./mirror";

/**
 * The commit a source's configured reference names on its remote right now,
 * read with ls-remote alone: nothing is fetched and no mirror is touched. A
 * reference that is a full commit SHA names itself. Failures are normalized
 * as acquisition failures are.
 */
export async function remoteHead(source: Pick<RepositorySource, "cloneUrl" | "gitRef">, options: { config?: FabricateConfig; runner?: GitRunner; signal?: AbortSignal } = {}): Promise<string> {
  const config = options.config ?? getConfig();
  try {
    if (source.gitRef && /^[0-9a-f]{40}$/.test(source.gitRef)) return source.gitRef;
    const { url, protocol } = gitSource(source, new SourceBoundary(config));
    const runner = options.runner ?? new GitRunner({ config });
    const advertised = parseLsRemote(await runner.lsRemote(url, protocol, options.signal));
    return advertisedCommit(advertised, resolveAdvertised(advertised, source.gitRef));
  } catch (error) {
    throw normalizeAcquisitionError(error);
  }
}
