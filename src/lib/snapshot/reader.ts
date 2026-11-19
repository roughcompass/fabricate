import { type Budgets, PolicyReader, ReadPolicy, type SkipDiagnostic, type TreeEntry, compareCodeUnits, entryTypeOf } from "@repo-facts/contract";
import { PROTECTED_DIRECTORY } from "@/lib/config";
import { GitError } from "@/lib/git/errors";
import type { GitRunner } from "@/lib/git/runner";

export type { Budgets, SkipDiagnostic, TreeEntry } from "@repo-facts/contract";

/**
 * Read-only access to one pinned commit, as a repo-facts `SourceReader`.
 * Analyzers never receive a checkout path or clone URL; they receive a
 * SnapshotReader, which enumerates the commit's tree and reads blob bytes
 * through controlled Git operations. No working tree or archive is ever
 * materialized.
 *
 * This class only fetches bytes. Every admission decision (traversal-shaped
 * and `.git` paths, protected directories, files that commonly hold
 * credentials, symbolic links and submodules as metadata, binary content, and
 * the per-blob, file-count, and total-byte budgets) belongs to the shared
 * read policy, with `fleet-kit` always protected.
 */

const OBJECT_ID = /^[0-9a-f]{40}$/;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export interface SnapshotReaderOptions {
  /** Directories protected in addition to `fleet-kit`, which is always protected. */
  protectedDirectories?: readonly string[];
}

export class SnapshotReader extends PolicyReader {
  private constructor(
    private readonly runner: GitRunner,
    private readonly gitDir: string,
    commit: string,
    entries: readonly TreeEntry[],
    rejected: readonly SkipDiagnostic[],
    budgets: Budgets,
    policy: ReadPolicy,
  ) {
    super(commit, entries, rejected, budgets, policy);
  }

  /**
   * Opens the commit named by a pinned internal ref: a snapshot's, or a
   * preview's pin of its own commit (`refs/fabricate/previews/<sha>`).
   * +expectedCommit+ guards against a ref that no longer names the recorded
   * snapshot.
   */
  static async open(runner: GitRunner, gitDir: string, internalRef: string, expectedCommit: string, budgets: Budgets, options: SnapshotReaderOptions = {}): Promise<SnapshotReader> {
    const previewPin = OBJECT_ID.test(expectedCommit) && internalRef === `refs/fabricate/previews/${expectedCommit}`;
    if (!/^refs\/fabricate\/snapshots\/(?:snp|srv)_[a-z0-9]{16}$/.test(internalRef) && !previewPin) {
      throw new GitError("command_rejected", "Snapshots are read only through pinned internal refs");
    }
    const commitSha = await runner.revParse(gitDir, `${internalRef}^{commit}`);
    if (commitSha !== expectedCommit) throw new GitError("command_rejected", `The pinned ref ${internalRef} no longer names commit ${expectedCommit}`);

    const policy = new ReadPolicy({ protectedDirectories: [...new Set([PROTECTED_DIRECTORY, ...(options.protectedDirectories ?? [])])] });
    const { entries, rejected } = parseTree(await runner.lsTree(gitDir, commitSha), policy);
    return new SnapshotReader(runner, gitDir, commitSha, entries, rejected, budgets, policy);
  }

  /** The pinned commit. A snapshot always has one. */
  get commitSha(): string {
    return this.commit!;
  }

  protected async fetchBlobs(entries: readonly TreeEntry[]): Promise<Map<string, Buffer>> {
    const limit = entries.reduce((sum, entry) => sum + (entry.size ?? 0) + 128, 0);
    return parseBatch(await this.runner.catFileBatch(this.gitDir, [...new Set(entries.map((entry) => entry.objectId))], limit));
  }

  protected async fetchLink(entry: TreeEntry): Promise<Buffer | null> {
    return parseBatch(await this.runner.catFileBatch(this.gitDir, [entry.objectId], (entry.size ?? 0) + 128)).get(entry.objectId) ?? null;
  }
}

/** Parses `git ls-tree -r -z -l -t` output; paths that are not UTF-8 are refused, and the policy filters the rest. */
function parseTree(output: Buffer, policy: ReadPolicy): { entries: TreeEntry[]; rejected: SkipDiagnostic[] } {
  const raw: TreeEntry[] = [];
  const undecodable: SkipDiagnostic[] = [];
  let start = 0;
  while (start < output.length) {
    const end = output.indexOf(0, start);
    const record = output.subarray(start, end === -1 ? output.length : end);
    start = end === -1 ? output.length : end + 1;
    if (record.length === 0) continue;

    const tab = record.indexOf(9);
    const header = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40}) +(-|\d+)$/.exec(record.subarray(0, tab).toString("latin1"));
    if (!header || tab === -1) throw new GitError("command_failed", "Unexpected ls-tree output");

    let path: string;
    try {
      path = utf8.decode(record.subarray(tab + 1));
    } catch {
      undecodable.push({ path: record.subarray(tab + 1).toString("latin1"), reason: "path_rejected", detail: "The path is not valid UTF-8" });
      continue;
    }
    const [, mode, kind, objectId, size] = header;
    raw.push({ path, mode: mode!, type: entryTypeOf(mode!, kind as "blob" | "tree" | "commit"), objectId: objectId!, size: size === "-" ? null : Number(size) });
  }
  // Traversal-shaped, .git, and protected paths never become readable entries.
  const { entries, rejected } = policy.filterEntries(raw);
  return { entries, rejected: [...rejected, ...undecodable].sort((a, b) => compareCodeUnits(a.path, b.path)) };
}

/** Parses `git cat-file --batch` output into object id => bytes. */
function parseBatch(output: Buffer): Map<string, Buffer> {
  const objects = new Map<string, Buffer>();
  let offset = 0;
  while (offset < output.length) {
    const newline = output.indexOf(10, offset);
    if (newline === -1) break;
    const header = output.subarray(offset, newline).toString("latin1");
    offset = newline + 1;
    if (header.endsWith(" missing")) continue;

    const match = /^([0-9a-f]{40}) (\w+) (\d+)$/.exec(header);
    if (!match || !OBJECT_ID.test(match[1]!)) throw new GitError("command_failed", "Unexpected cat-file output");
    const size = Number(match[3]);
    objects.set(match[1]!, Buffer.from(output.subarray(offset, offset + size)));
    offset += size + 1;
  }
  return objects;
}
