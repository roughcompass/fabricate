import { and, desc, eq, isNull } from "drizzle-orm";
import { NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { keyDigest } from "@/lib/demo/workspace-digest";
import { base64Url } from "@/lib/demo/workspace-key";
import type { PrototypesExecutor } from "./db/client";
import { prototypes, shares, versions } from "./db/schema";
import { PrototypesLimitError } from "./limits";
import { workspaceShell } from "./shell";

/**
 * Read-only share links (sharing-and-export spec, "A version can be shared
 * read-only" and "Share links can be revoked"; design.md, decision 8). A link
 * carries a random token, and only its digest is stored, with a copy of the
 * shell as it was when the link was created. Deleting the prototype, or
 * resetting the workspace, deletes its links.
 */

export type Share = typeof shares.$inferSelect;
type Version = typeof versions.$inferSelect;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isShareToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** Creates a link to one ready version of the workspace's prototypes and returns its token, which is never stored. */
export async function createShare(db: PrototypesExecutor, workspaceId: string, versionId: string, now = new Date()): Promise<string> {
  const [version] = await db
    .select({ id: versions.id, status: versions.status, prototypeId: versions.prototypeId })
    .from(versions)
    .where(and(eq(versions.workspaceId, workspaceId), eq(versions.id, versionId)));
  if (!version?.prototypeId) throw new NotFoundError("Unknown version");
  if (version.status !== "ready") throw new PrototypesLimitError("Only a ready version can be shared.");
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64Url(bytes);
  await db.insert(shares).values({ id: generatePublicId("shr"), workspaceId, versionId, tokenDigest: keyDigest(token), shell: await workspaceShell(db, workspaceId), createdAt: now });
  return token;
}

/** The workspace's live links to one prototype's versions, newest first. */
export async function sharesOf(db: PrototypesExecutor, workspaceId: string, prototypeId: string): Promise<(Share & { readonly number: number })[]> {
  const rows = await db
    .select({ share: shares, number: versions.number })
    .from(shares)
    .innerJoin(versions, eq(versions.id, shares.versionId))
    .where(and(eq(shares.workspaceId, workspaceId), eq(versions.prototypeId, prototypeId), isNull(shares.revokedAt)))
    .orderBy(desc(shares.createdAt));
  return rows.map((row) => ({ ...row.share, number: row.number ?? 0 }));
}

export async function revokeShare(db: PrototypesExecutor, workspaceId: string, shareId: string, now = new Date()): Promise<void> {
  const [revoked] = await db
    .update(shares)
    .set({ revokedAt: now })
    .where(and(eq(shares.id, shareId), eq(shares.workspaceId, workspaceId), isNull(shares.revokedAt)))
    .returning({ id: shares.id });
  if (!revoked) throw new NotFoundError("Unknown share link");
}

export interface SharedVersion {
  readonly share: Share;
  readonly version: Version;
  readonly prototypeName: string;
}

/** What a live link shows: its version, the prototype's name, and the shell it was made with. Null for a revoked or unknown link. */
export async function sharedVersion(db: PrototypesExecutor, token: string): Promise<SharedVersion | null> {
  if (!isShareToken(token)) return null;
  const [row] = await db
    .select({ share: shares, version: versions, prototypeName: prototypes.name })
    .from(shares)
    .innerJoin(versions, eq(versions.id, shares.versionId))
    .innerJoin(prototypes, eq(prototypes.id, versions.prototypeId))
    .where(and(eq(shares.tokenDigest, keyDigest(token)), isNull(shares.revokedAt), eq(versions.status, "ready")));
  return row ?? null;
}
