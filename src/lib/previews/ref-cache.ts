import { getConfig } from "@/lib/config";
import type { Repository } from "@/lib/repositories/repository-records";
import { type RefListing, type RefOptions, listRemoteRefs } from "./refs";

/*
 * Each remote's branches and tags as preview mode lists them, kept for
 * `previews.refCacheSeconds` (60 by default) in the web server's memory, so
 * a view, a device change, and the Code tab don't each run `git ls-remote`.
 * Views that ask while a read is under way share it. A remote that couldn't
 * be read is kept as briefly, so a slow or unreachable remote doesn't hold
 * up every view. Showing another ref reads the remote again
 * (forgetRemoteRefs), and so does the scheduled check, which never uses
 * this.
 */

interface Kept {
  readonly at: number;
  readonly listing: Promise<RefListing>;
}

/** By clone URL and configured reference, the newest last. */
const kept = new Map<string, Kept>();
/** How many remotes' listings are kept; the least recently read go first. */
const MOST = 500;

const keyOf = (repository: Pick<Repository, "cloneUrl" | "gitRef">) => `${repository.cloneUrl}\n${repository.gitRef ?? ""}`;

/**
 * The remote's branches and tags, as listRemoteRefs reads them, from a read
 * made in the last `previews.refCacheSeconds`, or read now. +options.now+
 * and +options.read+ stand in for the clock and the read in tests.
 */
export function cachedRemoteRefs(repository: Pick<Repository, "cloneUrl" | "gitRef">, options: RefOptions & { now?: number; read?: typeof listRemoteRefs } = {}): Promise<RefListing> {
  const config = options.config ?? getConfig();
  const read = options.read ?? listRemoteRefs;
  const ttl = config.previews.refCacheSeconds * 1_000;
  if (ttl === 0) return read(repository, { ...options, config });
  const now = options.now ?? Date.now();
  const key = keyOf(repository);
  const found = kept.get(key);
  if (found && now - found.at < ttl) return found.listing;
  const listing = read(repository, { ...options, config });
  kept.delete(key);
  kept.set(key, { at: now, listing });
  // A read that throws, rather than reporting the remote unavailable, isn't kept.
  listing.catch(() => kept.get(key)?.listing === listing && kept.delete(key));
  for (const oldest of kept.keys()) {
    if (kept.size <= MOST) break;
    kept.delete(oldest);
  }
  return listing;
}

/** Drops what's kept of +repository+'s remote, so its next listing reads it again. */
export function forgetRemoteRefs(repository: Pick<Repository, "cloneUrl">): void {
  for (const key of [...kept.keys()]) if (key.startsWith(`${repository.cloneUrl}\n`)) kept.delete(key);
}
