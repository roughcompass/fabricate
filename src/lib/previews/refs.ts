import crypto from "node:crypto";
import { gitSource, normalizeAcquisitionError } from "@/lib/acquisition/acquire";
import { AcquisitionError } from "@/lib/acquisition/errors";
import { type Advertisement, Mirror, advertisedCommit, parseLsRemote, resolveAdvertised } from "@/lib/acquisition/mirror";
import { withSourceLock } from "@/lib/acquisition/source-lease";
import { SourceBoundary } from "@/lib/catalog/source-boundary";
import { type RepositorySource, isValidGitRef } from "@/lib/catalog/source-records";
import { type FabricateConfig, getConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { GitRunner, type Protocol } from "@/lib/git/runner";
import type { PinnedCommit } from "./records";

/**
 * Remote refs for previews, read live, and the one commit a preview needs,
 * fetched on demand (design decision 2). Listing reads `ls-remote` with the
 * acquisition code's protocol and credential rules and a short timeout. A
 * chosen ref is fetched shallowly into a private incoming ref and verified
 * against the commit it was advertised at before the commit is pinned under
 * `refs/fabricate/previews/<sha>`, which, like snapshot refs, nothing that
 * clears acquisition refs ever removes. A SHA prefix resolves only among
 * advertised tips and commits already pinned for the Repository; no history
 * is fetched to resolve it.
 */

/** What the operator chose: a branch or tag (null for the remote's default branch), or a commit SHA or prefix. */
export type RefRequest = { readonly kind: "ref"; readonly name: string | null } | { readonly kind: "commit"; readonly sha: string };

export interface RemoteRef {
  /** The qualified ref, refs/heads/main or refs/tags/v1.4.0. */
  readonly name: string;
  /** The branch or tag name alone. */
  readonly label: string;
  readonly kind: "branch" | "tag";
  /** The commit it names; an annotated tag's target. */
  readonly commit: string;
  /** Whether it's the Repository's configured reference, or the default branch when none is configured. */
  readonly configured: boolean;
}

export interface RefListing {
  /** The configured reference, which can be requested even when the remote can't be listed. */
  readonly configured: { readonly label: string; readonly request: RefRequest };
  /** Branches, then tags, by name, with the configured reference first. Empty when the remote couldn't be listed. */
  readonly refs: readonly RemoteRef[];
  /** Why the remote's refs couldn't be listed, or null when they were. */
  readonly unavailable: string | null;
}

/** Why a requested ref or commit can't be pinned. */
export class RefResolutionError extends Error {
  override name = "RefResolutionError";

  constructor(
    readonly code: "unresolved" | "ambiguous" | "not_supplied" | "moved",
    message: string,
  ) {
    super(message);
  }
}

export interface RefOptions {
  config?: FabricateConfig;
  runner?: GitRunner;
  signal?: AbortSignal;
}

type Source = Pick<RepositorySource, "id" | "publicId" | "name" | "cloneUrl" | "gitRef">;

const LIST_TIMEOUT_MS = 15_000;
const FULL_SHA = /^[0-9a-f]{40}$/;
const SHA_PREFIX = /^[0-9a-f]{4,39}$/;
const ZERO = "0".repeat(40);

/** Where a preview's commit is pinned in the Repository's managed clone. */
export function previewPinRef(commitSha: string): string {
  if (!FULL_SHA.test(commitSha)) throw new RefResolutionError("unresolved", "Preview pins name a full commit SHA");
  return `refs/fabricate/previews/${commitSha}`;
}

/** What requesting the Repository's configured reference asks for: its commit when it's a full SHA, else the ref, or the default branch when none is set. */
export function configuredRequest(source: Pick<RepositorySource, "gitRef">): RefRequest {
  return source.gitRef && FULL_SHA.test(source.gitRef) ? { kind: "commit", sha: source.gitRef } : { kind: "ref", name: source.gitRef };
}

/** The remote's branches and tags, the configured reference first; the configured reference alone when the remote can't be read. */
export async function listRemoteRefs(source: Pick<RepositorySource, "cloneUrl" | "gitRef">, options: RefOptions = {}): Promise<RefListing> {
  const config = options.config ?? getConfig();
  const configured = { label: source.gitRef ?? "Default branch", request: configuredRequest(source) };
  try {
    const { url, protocol } = gitSource(source, new SourceBoundary(config));
    const runner = options.runner ?? new GitRunner({ config, timeoutMs: Math.min(LIST_TIMEOUT_MS, config.gitTimeoutSeconds * 1_000) });
    const advertised = parseLsRemote(await runner.lsRemote(url, protocol, options.signal));
    const configuredName = configuredRef(advertised, source.gitRef);
    const refs = [...advertised.refs.keys()]
      .filter((name) => name.startsWith("refs/heads/") || name.startsWith("refs/tags/"))
      .map((name): RemoteRef => {
        const kind = name.startsWith("refs/heads/") ? "branch" : "tag";
        return { name, label: name.slice(kind === "branch" ? 11 : 10), kind, commit: advertised.peeled.get(name) ?? advertised.refs.get(name)!, configured: name === configuredName };
      })
      .sort((a, b) => Number(b.configured) - Number(a.configured) || (a.kind === b.kind ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.kind === "branch" ? -1 : 1));
    return { configured, refs, unavailable: null };
  } catch (error) {
    return { configured, refs: [], unavailable: normalizeAcquisitionError(error).message };
  }
}

/**
 * Resolves +request+ to one commit of +source+'s remote and pins it, under
 * the source's mirror lock. Throws RefResolutionError when the request
 * names no commit, several, a commit the remote didn't supply, or a ref
 * that moved while it was fetched; other failures are normalized like
 * acquisition failures.
 */
export async function pinCommit(db: Executor, source: Source, request: RefRequest, options: RefOptions = {}): Promise<PinnedCommit> {
  const config = options.config ?? getConfig();
  const runner = options.runner ?? new GitRunner({ config });
  const { signal } = options;
  try {
    const checked = checkRequest(request);
    // The remote, and a local source's boundary check, are reached only when the mirror lacks the commit.
    let endpoint: { url: string; protocol: Protocol } | undefined;
    const connect = () => (endpoint ??= gitSource(source, new SourceBoundary(config)));
    return await withSourceLock(source.id, { waitMs: config.gitLockTimeoutSeconds * 1_000, signal }, async () => {
      const mirror = new Mirror(runner, source.publicId);
      await mirror.ensure();
      const remote = new Remote(runner, mirror, connect, `preview-${crypto.randomBytes(6).toString("hex")}`, signal);
      try {
        return checked.kind === "ref" ? await remote.pinRef(checked.name) : await remote.pinCommit(checked.sha);
      } finally {
        await mirror.clearIncoming(remote.key);
      }
    });
  } catch (error) {
    if (error instanceof RefResolutionError) throw error;
    throw normalizeAcquisitionError(error);
  }
}

/** +request+ with a commit SHA trimmed and lowercased, once it's well formed. */
function checkRequest(request: RefRequest): RefRequest {
  if (request.kind === "commit") {
    const sha = request.sha.trim().toLowerCase();
    if (!FULL_SHA.test(sha) && !SHA_PREFIX.test(sha)) throw new RefResolutionError("unresolved", "Enter at least 4 hexadecimal characters of a commit SHA");
    return { kind: "commit", sha };
  }
  if (request.name !== null && !isValidGitRef(request.name)) throw new RefResolutionError("unresolved", `${JSON.stringify(request.name)} is not a valid branch or tag name`);
  return request;
}

/** The configured reference among the advertised refs: the default branch when none is set. */
function configuredRef(advertised: Advertisement, gitRef: string | null): string | null {
  try {
    const resolved = resolveAdvertised(advertised, gitRef);
    return resolved.kind === "commit" ? null : resolved.name;
  } catch {
    return null;
  }
}

/** One pinning session against a source's remote and mirror. */
class Remote {
  private advertisement: Advertisement | null = null;

  constructor(
    private readonly runner: GitRunner,
    private readonly mirror: Mirror,
    private readonly connect: () => { url: string; protocol: Protocol },
    readonly key: string,
    private readonly signal?: AbortSignal,
  ) {}

  private get incoming(): string {
    return `refs/fabricate/incoming/${this.key}`;
  }

  /** A branch or tag, short or qualified, or the default branch for null: fetched, checked against its advertised commit, and pinned. */
  async pinRef(name: string | null): Promise<PinnedCommit> {
    const advertised = await this.advertised();
    let resolved;
    try {
      resolved = resolveAdvertised(advertised, name);
    } catch (error) {
      if (error instanceof AcquisitionError && (error.code === "invalid_ref" || error.code === "ambiguous_ref")) throw new RefResolutionError(error.code === "ambiguous_ref" ? "ambiguous" : "unresolved", error.message);
      throw error;
    }
    if (resolved.kind === "commit") return this.pinCommit(resolved.name);
    const expected = advertisedCommit(advertised, resolved);
    const fetched = await this.fetch(resolved.name);
    if (fetched !== expected) {
      throw new RefResolutionError("moved", `${resolved.name} moved from ${expected.slice(0, 12)} to ${fetched.slice(0, 12)} while it was fetched. Try again to preview its new commit.`);
    }
    await this.pin(fetched);
    return { commitSha: fetched, refName: resolved.name, refKind: resolved.kind === "tag" ? "tag" : "branch" };
  }

  /** A full SHA or a prefix of one. */
  async pinCommit(sha: string): Promise<PinnedCommit> {
    const commitSha = FULL_SHA.test(sha) ? sha : await this.resolvePrefix(sha);
    if (!(await this.acquired(commitSha))) await this.fetchCommit(commitSha);
    await this.pin(commitSha);
    return { commitSha, refName: null, refKind: "commit" };
  }

  /** The one advertised tip or already pinned commit that starts with +prefix+. */
  private async resolvePrefix(prefix: string): Promise<string> {
    const advertised = await this.advertised();
    const pinned = [...(await this.runner.forEachRef(this.mirror.gitDir, "refs/fabricate/snapshots/")), ...(await this.runner.forEachRef(this.mirror.gitDir, "refs/fabricate/previews/"))].map((ref) => ref.objectId);
    const matches = [...new Set([...tips(advertised), ...pinned])].filter((commit) => commit.startsWith(prefix));
    if (matches.length === 0) throw new RefResolutionError("unresolved", `No branch, tag, or acquired commit of this Repository starts with ${prefix}. Enter the full 40-character SHA of another commit.`);
    if (matches.length > 1) throw new RefResolutionError("ambiguous", `${prefix} matches ${matches.length} commits of this Repository. Enter more of the SHA.`);
    return matches[0]!;
  }

  /** Fetches a commit not yet in the mirror: through a ref advertised at it, otherwise by its exact SHA. */
  private async fetchCommit(commitSha: string): Promise<void> {
    const advertised = await this.advertised();
    const ref = [...advertised.refs.keys()].find((name) => (name.startsWith("refs/heads/") || name.startsWith("refs/tags/")) && (advertised.peeled.get(name) ?? advertised.refs.get(name)) === commitSha);
    // A ref that moved since it was advertised no longer supplies the commit; the exact fetch may still.
    if (ref && (await this.fetch(ref)) === commitSha) return;
    try {
      const { url, protocol } = this.connect();
      await this.runner.fetch(this.mirror.gitDir, url, [`+${commitSha}:${this.incoming}`], protocol, { signal: this.signal, shallow: true });
    } catch (error) {
      const normalized = normalizeAcquisitionError(error);
      if (["authentication_failed", "timeout", "canceled", "git_unavailable", "boundary_violation"].includes(normalized.code)) throw normalized;
      // A server may refuse to serve a commit no ref names, so a refusal isn't proof the commit doesn't exist.
      throw new RefResolutionError("not_supplied", `The remote didn't supply commit ${commitSha}. It may not exist there, or the server may not allow fetching a commit that no branch or tag names.`);
    }
    if ((await this.verified(this.incoming)) !== commitSha) throw new AcquisitionError("object_verification_failed", `The fetched object is not commit ${commitSha}`);
  }

  /** Fetches +ref+ shallowly into the incoming ref and returns the commit it names. */
  private async fetch(ref: string): Promise<string> {
    const { url, protocol } = this.connect();
    await this.runner.fetch(this.mirror.gitDir, url, [`+${ref}:${this.incoming}`], protocol, { signal: this.signal, shallow: true });
    const commit = await this.verified(this.incoming);
    if (!commit) throw new AcquisitionError("object_verification_failed", `${ref} does not name a commit`);
    return commit;
  }

  /** The commit +revision+ names, verified to be a commit whose tree is readable, or null. */
  private async verified(revision: string): Promise<string | null> {
    const commit = await this.runner.revParse(this.mirror.gitDir, `${revision}^{commit}`);
    if (!commit || !FULL_SHA.test(commit) || (await this.runner.objectType(this.mirror.gitDir, commit)) !== "commit") return null;
    const tree = await this.runner.revParse(this.mirror.gitDir, `${commit}^{tree}`);
    return tree && FULL_SHA.test(tree) ? commit : null;
  }

  private async acquired(commitSha: string): Promise<boolean> {
    return (await this.verified(commitSha)) === commitSha;
  }

  private async pin(commitSha: string): Promise<void> {
    const ref = previewPinRef(commitSha);
    if ((await this.runner.revParse(this.mirror.gitDir, ref)) === commitSha) return;
    await this.runner.updateRef(this.mirror.gitDir, ref, commitSha, ZERO);
  }

  private async advertised(): Promise<Advertisement> {
    const { url, protocol } = this.connect();
    return (this.advertisement ??= parseLsRemote(await this.runner.lsRemote(url, protocol, this.signal)));
  }
}

/** The commits the remote's branches and tags name, annotated tags peeled. */
function tips(advertised: Advertisement): string[] {
  return [...advertised.refs.keys()].filter((name) => name.startsWith("refs/heads/") || name.startsWith("refs/tags/")).map((name) => advertised.peeled.get(name) ?? advertised.refs.get(name)!);
}
