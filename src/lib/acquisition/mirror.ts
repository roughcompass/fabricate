import fs from "node:fs";
import path from "node:path";
import type { RefKind } from "@/lib/db/schema";
import { GitError } from "@/lib/git/errors";
import type { GitRunner, Protocol } from "@/lib/git/runner";
import { AcquisitionError } from "./errors";

/**
 * One source's managed bare object database under repository storage. Every
 * fetch lands in a private incoming ref, is peeled and verified as a commit,
 * and is then pinned under an internal snapshot ref.
 */

export interface ResolvedRef {
  kind: RefKind;
  /** The remote ref (refs/heads/main, refs/tags/v1) or the full commit id. */
  name: string;
}

/** A resolved reference with the commit the remote advertised for it, known before anything is fetched. */
export interface Resolution extends ResolvedRef {
  commitSha: string;
}

export interface FetchedCommit {
  commitSha: string;
  treeSha: string;
}

const FULL_SHA = /^[0-9a-f]{40}$/;
/** A survey's own pin; surveys made from earlier snapshots keep the snapshot's. */
const SNAPSHOT_REF = /^refs\/fabricate\/snapshots\/(?:snp|srv)_[a-z0-9]{16}$/;

/** The internal ref that pins a survey's commit. */
export function surveyRefFor(surveyPublicId: string): string {
  return `refs/fabricate/snapshots/${surveyPublicId}`;
}

function incomingRef(key: string): string {
  return `refs/fabricate/incoming/${key}`;
}

function fallbackRefs(key: string): string {
  return `refs/fabricate/fallback/${key}`;
}

export function mirrorPath(storage: string, repositoryPublicId: string): string {
  return path.join(storage, `${repositoryPublicId}.git`);
}

export class Mirror {
  readonly gitDir: string;

  constructor(
    readonly runner: GitRunner,
    readonly repositoryPublicId: string,
  ) {
    this.gitDir = mirrorPath(runner.storage, repositoryPublicId);
  }

  /** Creates the bare object database on first use. */
  async ensure(): Promise<void> {
    if (fs.existsSync(path.join(this.gitDir, "HEAD"))) return;
    fs.mkdirSync(path.dirname(this.gitDir), { recursive: true });
    await this.runner.initBare(this.gitDir);
  }

  /** Decides what the configured reference names on the remote, and the commit it advertises for it, so a survey is found before anything is fetched. */
  async resolve(url: string, protocol: Protocol, gitRef: string | null, signal?: AbortSignal): Promise<Resolution> {
    if (gitRef && FULL_SHA.test(gitRef)) return { kind: "commit", name: gitRef, commitSha: gitRef };
    const advertised = parseLsRemote(await this.runner.lsRemote(url, protocol, signal));
    const resolved = resolveAdvertised(advertised, gitRef);
    return { ...resolved, commitSha: advertisedCommit(advertised, resolved) };
  }

  /** Whether the mirror already holds +commitSha+, so a survey can pin it without fetching. */
  async hasCommit(commitSha: string): Promise<boolean> {
    if (!FULL_SHA.test(commitSha)) return false;
    try {
      return (await this.runner.objectType(this.gitDir, commitSha)) === "commit";
    } catch {
      return false;
    }
  }

  /** The tree of a commit the mirror holds. */
  async treeOf(commitSha: string): Promise<string> {
    const treeSha = await this.runner.revParse(this.gitDir, `${commitSha}^{tree}`);
    if (!treeSha || !FULL_SHA.test(treeSha)) throw new AcquisitionError("object_verification_failed", `The tree of ${commitSha} could not be read`);
    return treeSha;
  }

  /**
   * Fetches the resolved reference into a private incoming ref named by +key+
   * (the target's public id) and verifies the commit it names.
   */
  async fetch(url: string, protocol: Protocol, resolved: ResolvedRef, key: string, signal?: AbortSignal): Promise<FetchedCommit> {
    const incoming = incomingRef(key);
    try {
      await this.runner.fetch(this.gitDir, url, [`+${resolved.name}:${incoming}`], protocol, { signal, shallow: true });
    } catch (error) {
      // Some servers refuse to serve a commit by id. Fetch every branch and tag
      // instead and look for the commit among them.
      if (!(resolved.kind === "commit" && error instanceof GitError && error.code === "command_failed")) throw error;
      const fallback = fallbackRefs(key);
      await this.runner.fetch(this.gitDir, url, [`+refs/heads/*:${fallback}/heads/*`, `+refs/tags/*:${fallback}/tags/*`], protocol, { signal });
      if ((await this.runner.revParse(this.gitDir, `${resolved.name}^{commit}`)) !== resolved.name) {
        throw new AcquisitionError("invalid_ref", `The source has no commit ${resolved.name}`);
      }
      await this.runner.updateRef(this.gitDir, incoming, resolved.name);
    }
    return this.verify(incoming, resolved);
  }

  /** Pins +commitSha+ under an internal snapshot ref so later pruning cannot remove it. */
  async pin(snapshotRef: string, commitSha: string): Promise<void> {
    if (!SNAPSHOT_REF.test(snapshotRef)) throw new AcquisitionError("unexpected", "Snapshot refs live under refs/fabricate/snapshots/");
    await this.runner.updateRef(this.gitDir, snapshotRef, commitSha, "0".repeat(40));
  }

  async unpin(snapshotRef: string): Promise<void> {
    if (SNAPSHOT_REF.test(snapshotRef)) await this.runner.deleteRef(this.gitDir, snapshotRef);
  }

  /** Removes the private incoming and fallback refs of one acquisition. */
  async clearIncoming(key: string): Promise<void> {
    for (const pattern of [incomingRef(key), fallbackRefs(key)]) {
      for (const { ref } of await this.runner.forEachRef(this.gitDir, pattern)) await this.runner.deleteRef(this.gitDir, ref);
    }
  }

  private async verify(incomingRef: string, resolved: ResolvedRef): Promise<FetchedCommit> {
    const commitSha = await this.runner.revParse(this.gitDir, `${incomingRef}^{commit}`);
    if (!commitSha || !FULL_SHA.test(commitSha)) throw new AcquisitionError("object_verification_failed", `${resolved.name} does not name a commit`);
    if (resolved.kind === "commit" && commitSha !== resolved.name) {
      throw new AcquisitionError("object_verification_failed", `The fetched commit ${commitSha} does not match the configured commit ${resolved.name}`);
    }
    if ((await this.runner.objectType(this.gitDir, commitSha)) !== "commit") throw new AcquisitionError("object_verification_failed", `${commitSha} is not a commit`);

    const treeSha = await this.runner.revParse(this.gitDir, `${commitSha}^{tree}`);
    if (!treeSha || !FULL_SHA.test(treeSha)) throw new AcquisitionError("object_verification_failed", `The tree of ${commitSha} could not be read`);
    return { commitSha, treeSha };
  }
}

export interface Advertisement {
  refs: Map<string, string>;
  /** The commit an annotated tag points at, by the tag's ref. */
  peeled: Map<string, string>;
  symrefs: Map<string, string>;
}

export function parseLsRemote(output: string): Advertisement {
  const refs = new Map<string, string>();
  const peeled = new Map<string, string>();
  const symrefs = new Map<string, string>();
  for (const line of output.split("\n")) {
    const symref = /^ref: (\S+)\t(\S+)$/.exec(line);
    if (symref) {
      symrefs.set(symref[2]!, symref[1]!);
      continue;
    }
    const ref = /^([0-9a-f]{40})\t(\S+)$/.exec(line);
    if (!ref) continue;
    const [, sha, name] = ref as unknown as [string, string, string];
    if (name.endsWith("^{}")) peeled.set(name.slice(0, -3), sha);
    else refs.set(name, sha);
  }
  return { refs, peeled, symrefs };
}

/** What +gitRef+ names among the advertised refs: the default branch when it's null, else a branch or tag. */
export function resolveAdvertised(advertised: Advertisement, gitRef: string | null): ResolvedRef {
  if (gitRef && FULL_SHA.test(gitRef)) return { kind: "commit", name: gitRef };
  if (!gitRef) {
    const head = advertised.symrefs.get("HEAD");
    if (!head || !advertised.refs.has(head)) throw new AcquisitionError("invalid_ref", "The source has no default branch; it may be empty");
    return { kind: "default_branch", name: head };
  }

  if (gitRef.startsWith("refs/heads/") || gitRef.startsWith("refs/tags/")) {
    if (!advertised.refs.has(gitRef)) throw new AcquisitionError("invalid_ref", `The source has no ${gitRef}`);
    return { kind: gitRef.startsWith("refs/heads/") ? "branch" : "tag", name: gitRef };
  }

  const branch = `refs/heads/${gitRef}`;
  const tag = `refs/tags/${gitRef}`;
  const hasBranch = advertised.refs.has(branch);
  const hasTag = advertised.refs.has(tag);
  if (hasBranch && hasTag) {
    throw new AcquisitionError("ambiguous_ref", `${gitRef} names both a branch and a tag; configure refs/heads/${gitRef} or refs/tags/${gitRef}`);
  }
  if (hasBranch) return { kind: "branch", name: branch };
  if (hasTag) return { kind: "tag", name: tag };
  if (/^[0-9a-f]{7,39}$/.test(gitRef)) throw new AcquisitionError("invalid_ref", `${gitRef} is not a branch or tag; configure a full 40-character commit SHA`);
  throw new AcquisitionError("invalid_ref", `The source has no branch or tag named ${gitRef}`);
}

/** The commit +resolved+ names: an annotated tag's target, otherwise the advertised object. */
export function advertisedCommit(advertised: Advertisement, resolved: ResolvedRef): string {
  if (resolved.kind === "commit") return resolved.name;
  return advertised.peeled.get(resolved.name) ?? advertised.refs.get(resolved.name)!;
}
