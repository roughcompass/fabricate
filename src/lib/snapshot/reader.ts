import crypto from "node:crypto";
import { PROTECTED_DIRECTORY } from "@/lib/config";
import { GitError } from "@/lib/git/errors";
import type { GitRunner } from "@/lib/git/runner";
import { isSensitivePath } from "./sensitive";

/**
 * Read-only access to one pinned commit. Analyzers never receive a checkout
 * path or clone URL; they receive a SnapshotReader, which enumerates the
 * commit's tree and reads blob bytes through controlled Git operations. No
 * working tree or archive is ever materialized.
 *
 * The reader sorts paths deterministically, exposes each entry's mode, type,
 * size, and object id, treats symbolic links and Git links (submodules) as
 * metadata that is never followed, refuses traversal-shaped and protected
 * paths, never reads files that commonly hold credentials (see sensitive.ts),
 * classifies binary content without parsing it, and enforces the
 * per-blob, file-count, and total-byte budgets. Every skipped input is
 * recorded as a diagnostic for profile reconciliation.
 */

export type EntryType = "file" | "executable" | "symlink" | "gitlink" | "tree";

export interface TreeEntry {
  path: string;
  mode: string;
  type: EntryType;
  objectId: string;
  /** Blob size in bytes; null for trees and Git links. */
  size: number | null;
}

export type SkipReason = "blob_too_large" | "file_budget_exhausted" | "total_budget_exhausted" | "binary" | "symlink" | "gitlink" | "not_a_file" | "path_rejected" | "protected_path" | "sensitive" | "missing";

export interface SkipDiagnostic {
  path: string;
  reason: SkipReason;
  detail: string;
}

export interface BlobContent {
  entry: TreeEntry;
  bytes: Buffer;
  /** UTF-8 text, or null when the content is binary or not valid UTF-8. */
  text: string | null;
  binary: boolean;
  /** SHA-256 of the blob bytes, hex. */
  digest: string;
}

export type ReadResult = { ok: true; content: BlobContent } | { ok: false; skip: SkipDiagnostic };

export interface Budgets {
  maxBlobBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
}

const OBJECT_ID = /^[0-9a-f]{40}$/;
const BINARY_SNIFF_BYTES = 8_000;
const MAX_LINK_BYTES = 4_096;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export class SnapshotReader {
  private readonly byPath: Map<string, TreeEntry>;
  private readonly cache = new Map<string, ReadResult>();
  private readonly skipped = new Map<string, SkipDiagnostic>();
  private filesRead = 0;
  private bytesRead = 0;

  private constructor(
    private readonly runner: GitRunner,
    private readonly gitDir: string,
    readonly commitSha: string,
    readonly entries: readonly TreeEntry[],
    rejected: readonly SkipDiagnostic[],
    readonly budgets: Budgets,
  ) {
    this.byPath = new Map(entries.map((entry) => [entry.path, entry]));
    for (const diagnostic of rejected) this.skipped.set(diagnostic.path, diagnostic);
  }

  /**
   * Opens the commit named by a pinned internal ref. +expectedCommit+ guards
   * against a ref that no longer names the recorded snapshot.
   */
  static async open(runner: GitRunner, gitDir: string, internalRef: string, expectedCommit: string, budgets: Budgets): Promise<SnapshotReader> {
    if (!/^refs\/fabricate\/snapshots\/snp_[a-z0-9]{16}$/.test(internalRef)) throw new GitError("command_rejected", "Snapshots are read only through pinned internal refs");
    const commitSha = await runner.revParse(gitDir, `${internalRef}^{commit}`);
    if (commitSha !== expectedCommit) throw new GitError("command_rejected", `The pinned ref ${internalRef} no longer names commit ${expectedCommit}`);

    const { entries, rejected } = parseTree(await runner.lsTree(gitDir, commitSha));
    return new SnapshotReader(runner, gitDir, commitSha, entries, rejected, budgets);
  }

  /** Blob entries (regular and executable files), in path order. */
  files(): TreeEntry[] {
    return this.entries.filter((entry) => entry.type === "file" || entry.type === "executable");
  }

  entry(path: string): TreeEntry | undefined {
    return this.byPath.get(path);
  }

  /** Reads one path. Only files in the pinned tree can be read. */
  async read(path: string): Promise<ReadResult> {
    return (await this.readMany([path])).get(path)!;
  }

  /**
   * Reads several paths in one batch. Paths are processed in sorted order so
   * budget consumption, and therefore every result, is deterministic.
   */
  async readMany(paths: readonly string[]): Promise<Map<string, ReadResult>> {
    const results = new Map<string, ReadResult>();
    const toFetch: TreeEntry[] = [];

    for (const path of [...new Set(paths)].sort(compareCodeUnits)) {
      const cached = this.cache.get(path);
      if (cached) {
        results.set(path, cached);
        continue;
      }
      const decision = this.admit(path);
      if ("skip" in decision) {
        results.set(path, this.remember(path, { ok: false, skip: decision.skip }));
        continue;
      }
      toFetch.push(decision.entry);
    }

    if (toFetch.length) {
      const limit = toFetch.reduce((sum, entry) => sum + (entry.size ?? 0) + 128, 0);
      const objects = parseBatch(await this.runner.catFileBatch(this.gitDir, [...new Set(toFetch.map((entry) => entry.objectId))], limit));
      for (const entry of toFetch) {
        const bytes = objects.get(entry.objectId);
        const result: ReadResult = bytes ? { ok: true, content: describe(entry, bytes) } : { ok: false, skip: { path: entry.path, reason: "missing", detail: `Object ${entry.objectId} is not in the snapshot` } };
        results.set(entry.path, this.remember(entry.path, result));
      }
    }
    return new Map([...results.entries()].sort(([a], [b]) => compareCodeUnits(a, b)));
  }

  /** The text of a symbolic link, read as committed data. The link is never followed. */
  async linkTarget(path: string): Promise<string | null> {
    const entry = this.byPath.get(path);
    if (entry?.type !== "symlink" || (entry.size ?? 0) > MAX_LINK_BYTES) return null;
    const bytes = parseBatch(await this.runner.catFileBatch(this.gitDir, [entry.objectId], (entry.size ?? 0) + 128)).get(entry.objectId);
    return bytes ? bytes.toString("utf8") : null;
  }

  /** Every skipped input, sorted by path. */
  diagnostics(): SkipDiagnostic[] {
    return [...this.skipped.values()].sort((a, b) => compareCodeUnits(a.path, b.path));
  }

  usage(): { files: number; bytes: number } {
    return { files: this.filesRead, bytes: this.bytesRead };
  }

  private admit(path: string): { entry: TreeEntry } | { skip: SkipDiagnostic } {
    const pathProblem = rejectPath(path);
    if (pathProblem) return { skip: pathProblem };

    const entry = this.byPath.get(path);
    if (!entry) return { skip: { path, reason: "missing", detail: "The path is not in the pinned tree" } };
    if (isSensitivePath(path)) return { skip: { path, reason: "sensitive", detail: "Files that commonly hold credentials are recorded but never read" } };
    if (entry.type === "symlink") return { skip: { path, reason: "symlink", detail: "Symbolic links are recorded as metadata and never followed" } };
    if (entry.type === "gitlink") return { skip: { path, reason: "gitlink", detail: "Submodules are recorded as metadata and never fetched" } };
    if (entry.type === "tree") return { skip: { path, reason: "not_a_file", detail: "The path is a directory" } };

    const size = entry.size ?? 0;
    const { maxBlobBytes, maxFiles, maxTotalBytes } = this.budgets;
    if (size > maxBlobBytes) return { skip: { path, reason: "blob_too_large", detail: `${size} bytes exceeds the ${maxBlobBytes}-byte limit per file` } };
    if (this.filesRead >= maxFiles) return { skip: { path, reason: "file_budget_exhausted", detail: `The ${maxFiles}-file analysis budget was already used` } };
    if (this.bytesRead + size > maxTotalBytes) return { skip: { path, reason: "total_budget_exhausted", detail: `Reading ${size} more bytes would exceed the ${maxTotalBytes}-byte analysis budget` } };

    this.filesRead++;
    this.bytesRead += size;
    return { entry };
  }

  private remember(path: string, result: ReadResult): ReadResult {
    this.cache.set(path, result);
    if (!result.ok) this.skipped.set(path, result.skip);
    else if (result.content.binary) this.skipped.set(path, { path, reason: "binary", detail: "Binary content is inventoried but not parsed" });
    return result;
  }
}

/** Sorts by UTF-16 code unit, independent of locale. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Refuses paths that could escape or alias outside the pinned tree, or that name the protected tree. */
export function rejectPath(path: string): SkipDiagnostic | null {
  const segments = path.split("/");
  if (!path || path.startsWith("/") || path.includes("\\") || /[\x00-\x1f]/.test(path) || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return { path, reason: "path_rejected", detail: "The path is not a plain relative path inside the snapshot" };
  }
  if (segments.some((segment) => segment.toLowerCase() === ".git")) return { path, reason: "path_rejected", detail: "Paths inside .git are never read" };
  if (segments.includes(PROTECTED_DIRECTORY)) return { path, reason: "protected_path", detail: `Paths under a ${PROTECTED_DIRECTORY}/ directory are never read` };
  return null;
}

function describe(entry: TreeEntry, bytes: Buffer): BlobContent {
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  const binary = bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
  let text: string | null = null;
  if (!binary) {
    try {
      text = utf8.decode(bytes);
    } catch {
      text = null;
    }
  }
  return { entry, bytes, text, binary: binary || text === null, digest };
}

function parseTree(output: Buffer): { entries: TreeEntry[]; rejected: SkipDiagnostic[] } {
  const entries: TreeEntry[] = [];
  const rejected: SkipDiagnostic[] = [];
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
      rejected.push({ path: record.subarray(tab + 1).toString("latin1"), reason: "path_rejected", detail: "The path is not valid UTF-8" });
      continue;
    }
    // Traversal-shaped, .git, and protected paths never become readable entries.
    const problem = rejectPath(path);
    if (problem) {
      rejected.push(problem);
      continue;
    }
    const [, mode, kind, objectId, size] = header;
    entries.push({ path, mode: mode!, type: entryType(mode!, kind!), objectId: objectId!, size: size === "-" ? null : Number(size) });
  }
  entries.sort((a, b) => compareCodeUnits(a.path, b.path));
  return { entries, rejected };
}

function entryType(mode: string, kind: string): EntryType {
  if (kind === "tree") return "tree";
  if (kind === "commit" || mode === "160000") return "gitlink";
  if (mode === "120000") return "symlink";
  if (mode === "100755") return "executable";
  return "file";
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
