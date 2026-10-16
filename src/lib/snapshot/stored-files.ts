import { createHash } from "node:crypto";
import { type Budgets, MemoryReader, type SourceReader, compareCodeUnits, gitBlobId } from "@repo-facts/contract";
import { PROTECTED_DIRECTORY } from "@/lib/config";

/**
 * Read-only access to a set of files DE FabLab stores itself, such as a
 * template version's exported project (converge-templates-and-prototypes
 * design.md, decision 1). It is repo-facts' own MemoryReader, the reference
 * reader the conformance suite compares every other reader with, under the
 * same read policy as a pinned commit: no Git, no disk, and no network. The
 * content digest is the Git tree object id of the files, so evidence object
 * ids are Git blob ids, as repo-facts requires, and the same files always
 * have the same digest.
 */

export type StoredFiles = Readonly<Record<string, string | Uint8Array>>;

const bytes = (content: string | Uint8Array) => (typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content));

/** The Git tree object id of the files, as `git write-tree` would compute it for a tree of regular files. */
export function treeObjectId(files: StoredFiles): string {
  type Node = { blobs: Map<string, string>; trees: Map<string, Node> };
  const root: Node = { blobs: new Map(), trees: new Map() };
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let child = node.trees.get(part);
      if (!child) node.trees.set(part, (child = { blobs: new Map(), trees: new Map() }));
      node = child;
    }
    node.blobs.set(parts.at(-1)!, gitBlobId(bytes(content)));
  }
  const write = (node: Node): string => {
    // Git orders entries by name, comparing a tree's name as if it ended in "/".
    const entries = [
      ...[...node.blobs].map(([name, id]) => ({ name, key: name, mode: "100644", id })),
      ...[...node.trees].map(([name, child]) => ({ name, key: `${name}/`, mode: "40000", id: write(child) })),
    ].sort((left, right) => compareCodeUnits(left.key, right.key));
    const body = Buffer.concat(entries.map((entry) => Buffer.concat([Buffer.from(`${entry.mode} ${entry.name}\0`), Buffer.from(entry.id, "hex")])));
    return createHash("sha1").update(Buffer.concat([Buffer.from(`tree ${body.length}\0`), body])).digest("hex");
  };
  return write(root);
}

export interface StoredFilesReader {
  readonly reader: SourceReader;
  /** The Git tree object id of the files, which takes the place of a commit SHA. */
  readonly digest: string;
}

/** Opens a reader on stored files, with `fleet-kit` always protected, as for a pinned commit. */
export function openStoredFiles(files: StoredFiles, budgets: Budgets, options: { protectedDirectories?: readonly string[] } = {}): StoredFilesReader {
  const reader = MemoryReader.fromFiles(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, typeof content === "string" ? content : new Uint8Array(content)])), {
    commit: null,
    budgets,
    protectedDirectories: [...new Set([PROTECTED_DIRECTORY, ...(options.protectedDirectories ?? [])])],
  });
  return { reader, digest: treeObjectId(files) };
}
