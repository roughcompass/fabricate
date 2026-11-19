import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { type SQL, and, eq, inArray, isNull } from "drizzle-orm";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { type AttemptState, previewBuilds, previewPreparations, repositorySources } from "@/lib/db/schema";
import { assertEnrolled } from "./access";
import { type PreviewBuild, findPreview, rebuildPreview, settleAbandonedAttempts, startPreview } from "./records";
import { attemptLogFile, cacheDirectory, previewDirectory } from "./storage";

/**
 * A preview's life after it's queued (design decisions 1 and 8, spec
 * "Previews can be rebuilt, deleted, and are pruned"): the operator's
 * requests to start or rebuild one, which check the feature switch and the
 * Repository's enrollment; deletion, of one preview or of every preview of a
 * deleted Repository; and pruning to `previews.maxStorageBytes` after each
 * successful build.
 *
 * Deleting marks the row deleted in a transaction, which ends serving at
 * once and keeps any attempt still running from publishing or restoring it,
 * since only the current attempt of an undeleted preview can. Its files are
 * then moved out of the way in one rename and removed. Pruning deletes the
 * same way, and also sweeps files no undeleted preview owns, such as those a
 * process stopped before removing.
 */

// -- Requests -----------------------------------------------------------------------

/**
 * Starts the preview of +packageDir+ from a ready preparation, as the
 * operator chose it, or opens the existing one, only while previews are on
 * and the Repository is enrolled.
 */
export function requestPreview(db: Executor, preparationPublicId: string, packageDir: string, config: FrontendRegistryConfig = getConfig()): { preview: PreviewBuild; created: boolean } {
  return immediate(db, (tx) => {
    const preparation = tx.select().from(previewPreparations).where(eq(previewPreparations.publicId, preparationPublicId)).get();
    if (!preparation) throw new NotFoundError(`Preview preparation ${preparationPublicId} does not exist`);
    assertEnrolled(config, sourceOf(tx, preparation.repositorySourceId));
    return startPreview(tx, preparationPublicId, packageDir);
  });
}

/** Starts the next attempt of a preview, only while previews are on and its Repository is enrolled. */
export function requestRebuild(db: Executor, publicId: string, config: FrontendRegistryConfig = getConfig()): PreviewBuild {
  return immediate(db, (tx) => {
    const preview = findPreview(tx, publicId);
    if (!preview) throw new NotFoundError(`Preview ${publicId} does not exist`);
    assertEnrolled(config, sourceOf(tx, preview.repositorySourceId));
    return rebuildPreview(tx, publicId);
  });
}

function sourceOf(db: Executor, id: number) {
  return db.select().from(repositorySources).where(eq(repositorySources.id, id)).get()!;
}

// -- Deletion -----------------------------------------------------------------------

/**
 * Deletes a preview and its files. Its paths answer not found once this
 * returns, and an attempt still running can neither publish to it nor
 * restore it. Deleting needs neither the feature switch nor enrollment, so
 * storage can always be reclaimed. Returns false when there's no such
 * undeleted preview.
 */
export async function deletePreview(db: Executor, publicId: string, config: FrontendRegistryConfig = getConfig()): Promise<boolean> {
  const deleted = immediate(db, (tx) => markDeleted(tx, eq(previewBuilds.publicId, publicId)));
  await discardPreviewFiles(config, deleted);
  return deleted.length > 0;
}

/**
 * Marks every undeleted preview of the Repository +sourceId+ deleted, in the
 * caller's transaction, which deletes the Repository. Returns their public
 * ids, whose files the caller discards once the transaction commits.
 */
export function deleteRepositoryPreviews(db: Executor, sourceId: number): string[] {
  return markDeleted(db, eq(previewBuilds.repositorySourceId, sourceId));
}

function markDeleted(db: Executor, where: SQL | undefined): string[] {
  const now = new Date();
  return db
    .update(previewBuilds)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(isNull(previewBuilds.deletedAt), where))
    .returning({ publicId: previewBuilds.publicId })
    .all()
    .map((row) => row.publicId);
}

/**
 * Removes the files of deleted previews. Each preview's directory is renamed
 * into `.trash/` before this returns, so nothing is left at its path even
 * while a build is still writing into it, and is then removed. Never
 * rejects: what it can't remove, the next prune sweeps.
 */
export function discardPreviewFiles(config: FrontendRegistryConfig, publicIds: readonly string[]): Promise<void> {
  const removals: string[] = [];
  for (const publicId of publicIds) {
    const directory = previewDirectory(config, publicId);
    if (!fs.existsSync(directory)) continue;
    const trashed = path.join(trashDirectory(config), `${publicId}-${crypto.randomBytes(4).toString("hex")}`);
    try {
      fs.mkdirSync(path.dirname(trashed), { recursive: true });
      fs.renameSync(directory, trashed);
      removals.push(trashed);
    } catch {
      removals.push(directory);
    }
  }
  return Promise.all(removals.map((directory) => fsp.rm(directory, { recursive: true, force: true }).catch(() => {}))).then(() => {});
}

function trashDirectory(config: FrontendRegistryConfig): string {
  return path.join(config.previews.storage, ".trash");
}

// -- Pruning ------------------------------------------------------------------------

/** What pruning weighs about one undeleted preview. */
export interface PruneCandidate {
  readonly publicId: string;
  readonly state: AttemptState;
  /** Its published artifact and its latest attempt's log. */
  readonly bytes: number;
  readonly lastOpenedAt: Date | null;
  /** When its latest attempt finished, if it has. */
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
}

/**
 * The previews to delete so the rest fit in +limit+ bytes: Ready and Failed
 * previews, least recently used first, until the total fits, and none that
 * is Queued or Building or is +keep+. A preview was last used when it was
 * last opened or, if later, when its latest attempt finished or it was
 * created, so a build nobody has opened yet isn't the first to go. When the
 * total can't fit without deleting a preview that's building, every
 * deletable preview goes and the total stays over.
 */
export function choosePrunable(previews: readonly PruneCandidate[], limit: number, keep?: string): string[] {
  let total = previews.reduce((sum, preview) => sum + preview.bytes, 0);
  if (total <= limit) return [];
  const used = (preview: PruneCandidate) => Math.max(preview.lastOpenedAt?.getTime() ?? 0, (preview.finishedAt ?? preview.createdAt).getTime());
  const deletable = previews
    .filter((preview) => (preview.state === "ready" || preview.state === "failed") && preview.publicId !== keep)
    .sort((a, b) => used(a) - used(b) || (a.publicId < b.publicId ? -1 : 1));
  const chosen: string[] = [];
  for (const preview of deletable) {
    if (total <= limit) break;
    chosen.push(preview.publicId);
    total -= preview.bytes;
  }
  return chosen;
}

export interface PruneResult {
  /** The previews deleted, least recently used first. */
  readonly deleted: string[];
  /** What the undeleted previews hold afterward, and the limit. */
  readonly bytes: number;
  readonly limit: number;
}

/**
 * Deletes the least recently used Ready and Failed previews until the stored
 * output of every preview, their published artifacts and latest logs, fits in
 * `previews.maxStorageBytes`, never one that's building or +keep+, the
 * preview that was just published. Fails abandoned attempts first, so a
 * preview whose worker died isn't held as building forever. A preview whose
 * state or last open changed since it was weighed is left for the next prune.
 * Finally removes files no undeleted preview owns.
 */
export async function prunePreviews(db: Executor, config: FrontendRegistryConfig = getConfig(), options: { keep?: string } = {}): Promise<PruneResult> {
  settleAbandonedAttempts(db);
  const rows = db.select().from(previewBuilds).where(isNull(previewBuilds.deletedAt)).all();
  const candidates = await Promise.all(
    rows.map(async (row): Promise<PruneCandidate> => ({ publicId: row.publicId, state: row.attemptState, bytes: (row.outputBytes ?? 0) + (await logBytes(config, row)), lastOpenedAt: row.lastOpenedAt, finishedAt: row.finishedAt, createdAt: row.createdAt })),
  );
  const chosen = new Set(choosePrunable(candidates, config.previews.maxStorageBytes, options.keep));
  const weighed = rows.filter((row) => chosen.has(row.publicId));
  const deleted = weighed.length
    ? immediate(db, (tx) =>
        weighed.flatMap((row) =>
          markDeleted(tx, and(eq(previewBuilds.id, row.id), inArray(previewBuilds.attemptState, ["ready", "failed"]), row.lastOpenedAt === null ? isNull(previewBuilds.lastOpenedAt) : eq(previewBuilds.lastOpenedAt, row.lastOpenedAt))),
        ),
      )
    : [];
  await discardPreviewFiles(config, deleted);
  await sweepStorage(db, config);
  const freed = new Set(deleted);
  return { deleted, bytes: candidates.filter((candidate) => !freed.has(candidate.publicId)).reduce((sum, candidate) => sum + candidate.bytes, 0), limit: config.previews.maxStorageBytes };
}

/**
 * How much the package caches every build shares hold, counting a file
 * linked more than once only once. Design decision 8 has the package
 * managers prune them when this passes half of `previews.maxStorageBytes`.
 */
export async function cacheBytes(config: FrontendRegistryConfig): Promise<number> {
  const seen = new Set<string>();
  let total = 0;
  const pending = [cacheDirectory(config)];
  while (pending.length) {
    const directory = pending.pop()!;
    const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
        continue;
      }
      const stat = await fsp.lstat(full).catch(() => null);
      if (!stat || seen.has(`${stat.dev}:${stat.ino}`)) continue;
      seen.add(`${stat.dev}:${stat.ino}`);
      total += stat.size;
    }
  }
  return total;
}

async function logBytes(config: FrontendRegistryConfig, preview: Pick<PreviewBuild, "publicId" | "attemptLog">): Promise<number> {
  const file = attemptLogFile(config, preview);
  return file ? ((await fsp.stat(file).catch(() => null))?.size ?? 0) : 0;
}

/**
 * Removes what no undeleted preview owns: the trash, and the directory of
 * any preview that's deleted or unknown. The package caches and anything
 * that isn't named for a preview are left alone.
 */
async function sweepStorage(db: Executor, config: FrontendRegistryConfig): Promise<void> {
  const names = await fsp.readdir(config.previews.storage).catch(() => [] as string[]);
  const live = new Set(
    db
      .select({ publicId: previewBuilds.publicId })
      .from(previewBuilds)
      .where(isNull(previewBuilds.deletedAt))
      .all()
      .map((row) => row.publicId),
  );
  const orphans = names.filter((name) => isPublicId(name, "pvw") && !live.has(name)).map((name) => path.join(config.previews.storage, name));
  const trash = await fsp.readdir(trashDirectory(config)).catch(() => [] as string[]);
  await Promise.all([...orphans, ...trash.map((name) => path.join(trashDirectory(config), name))].map((directory) => fsp.rm(directory, { recursive: true, force: true }).catch(() => {})));
}
