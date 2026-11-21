import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { lte } from "drizzle-orm";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { mockSetImports, mockSets } from "@/lib/db/schema";

/*
 * Where mock sets keep their bodies (add-mock-sets, design decision 9):
 *
 *     <previews.storage>/.mock-sets/<mks_…>/<sha256>      a set's response bodies and request bodies to compare
 *     <previews.storage>/.mock-imports/<mki_…>/calls.json  an upload's sanitized, grouped calls, until its review is saved or cancelled
 *     <previews.storage>/.mock-imports/<mki_…>/<sha256>    their bodies
 *
 * Bodies are content-addressed, so a body a set holds twice is stored once.
 * Each is written to a temporary name and renamed, so a failed write leaves
 * no partial file. Deleting moves a directory into `.trash/` first, as
 * deleting a preview does, so nothing is left at its path, then removes it.
 * The sweep, run with the worker's periodic check, removes set directories
 * with no row, such as those an application's or a Repository's deletion
 * cascaded to, and drafts past their expiry. No body ever goes into SQLite.
 */

export const MOCK_SETS_DIRECTORY = ".mock-sets";
export const MOCK_IMPORTS_DIRECTORY = ".mock-imports";
const TRASH_DIRECTORY = ".trash";

const DIGEST = /^[0-9a-f]{64}$/;

/** The directory of every set's bodies. */
export function mockSetsRoot(config: FrontendRegistryConfig): string {
  return path.join(config.previews.storage, MOCK_SETS_DIRECTORY);
}

/** The directory of every upload's draft. */
export function mockImportsRoot(config: FrontendRegistryConfig): string {
  return path.join(config.previews.storage, MOCK_IMPORTS_DIRECTORY);
}

/** A set's own directory of bodies. */
export function setDirectory(config: FrontendRegistryConfig, setPublicId: string): string {
  if (!isPublicId(setPublicId, "mks")) throw new Error(`${JSON.stringify(setPublicId)} is not a mock set id`);
  return path.join(mockSetsRoot(config), setPublicId);
}

/**
 * An upload's draft directory.
 * @public HAR import drafts use this (add-mock-sets, task 3.5).
 */
export function importDirectory(config: FrontendRegistryConfig, importPublicId: string): string {
  if (!isPublicId(importPublicId, "mki")) throw new Error(`${JSON.stringify(importPublicId)} is not an import id`);
  return path.join(mockImportsRoot(config), importPublicId);
}

/** +bytes+' SHA-256, as hexadecimal, which names its file. */
export function digestOf(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function isDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

function bodyFile(directory: string, digest: string): string {
  if (!isDigest(digest)) throw new Error(`${JSON.stringify(digest)} is not a body digest`);
  return path.join(directory, digest);
}

/** A file's content written to a temporary name in the same directory, then renamed over +file+. */
export function writeAtomically(file: string, content: Uint8Array | string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/** Stores +bytes+ in +directory+ by its digest, once, and returns the digest and size. */
export function writeBody(directory: string, bytes: Uint8Array): { digest: string; size: number } {
  const digest = digestOf(bytes);
  const file = bodyFile(directory, digest);
  if (!fs.existsSync(file)) writeAtomically(file, bytes);
  return { digest, size: bytes.byteLength };
}

/** The body +digest+ names in +directory+, or null when it isn't there. */
export function readBody(directory: string, digest: string): Buffer | null {
  if (!isDigest(digest)) return null;
  try {
    return fs.readFileSync(bodyFile(directory, digest));
  } catch {
    return null;
  }
}

/** Whether +directory+ holds the body +digest+. */
export function hasBody(directory: string, digest: string): boolean {
  return isDigest(digest) && fs.existsSync(bodyFile(directory, digest));
}

/**
 * Copies the body +digest+ from one directory into another, unless it's there already.
 * @public HAR import drafts use this (add-mock-sets, task 3.5).
 */
export function copyBody(from: string, to: string, digest: string): void {
  const target = bodyFile(to, digest);
  if (fs.existsSync(target)) return;
  const bytes = fs.readFileSync(bodyFile(from, digest));
  writeAtomically(target, bytes);
}

/** Removes the bodies in +directory+ that +keep+ doesn't name, and any temporary file a failed write left. */
export function removeUnusedBodies(directory: string, keep: ReadonlySet<string>): void {
  let names: string[];
  try {
    names = fs.readdirSync(directory);
  } catch {
    return;
  }
  for (const name of names) {
    if ((isDigest(name) && !keep.has(name)) || name.endsWith(".tmp")) fs.rmSync(path.join(directory, name), { force: true });
  }
}

/**
 * Moves +directory+ into `.trash/` under `previews.storage`, so nothing is
 * left at its path, then removes it. Never throws: what it can't remove, the
 * sweep removes.
 */
export function discardDirectory(config: FrontendRegistryConfig, directory: string): void {
  if (!fs.existsSync(directory)) return;
  const trashed = path.join(config.previews.storage, TRASH_DIRECTORY, `${path.basename(directory)}-${crypto.randomBytes(4).toString("hex")}`);
  let target = directory;
  try {
    fs.mkdirSync(path.dirname(trashed), { recursive: true });
    fs.renameSync(directory, trashed);
    target = trashed;
  } catch {
    // Removed where it is.
  }
  void fsp.rm(target, { recursive: true, force: true }).catch(() => {});
}

/**
 * Removes what no row owns: set directories whose set is gone, drafts past
 * their expiry with their rows, and draft directories with no row. Anything
 * else under `previews.storage`, such as previews and package caches, is
 * left alone. Returns how many directories it removed.
 */
export async function sweepMockStorage(db: Executor, config: FrontendRegistryConfig, now: Date = new Date()): Promise<number> {
  // An expired draft's row goes first, so its directory is then one with no row.
  db.delete(mockSetImports).where(lte(mockSetImports.expiresAt, now)).run();
  const sets = new Set(
    db
      .select({ publicId: mockSets.publicId })
      .from(mockSets)
      .all()
      .map((row) => row.publicId),
  );
  const drafts = new Set(
    db
      .select({ publicId: mockSetImports.publicId })
      .from(mockSetImports)
      .all()
      .map((row) => row.publicId),
  );
  const orphans = async (root: string, prefix: "mks" | "mki", live: Set<string>) =>
    (await fsp.readdir(root).catch(() => [] as string[])).filter((name) => isPublicId(name, prefix) && !live.has(name)).map((name) => path.join(root, name));
  const removed = [...(await orphans(mockSetsRoot(config), "mks", sets)), ...(await orphans(mockImportsRoot(config), "mki", drafts))];
  await Promise.all(removed.map((directory) => fsp.rm(directory, { recursive: true, force: true }).catch(() => {})));
  return removed.length;
}
