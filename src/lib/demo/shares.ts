import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "@/lib/db/client";
import { demoShares } from "@/lib/db/schema";
import { base64Url } from "./workspace-key";
import { keyDigest } from "./workspaces";

/**
 * Share links to a view of a running application (template-demo/toolbar
 * spec, "Visitors can share an application view"; add-applications, design
 * decision 7). A link carries a random token and captures the application,
 * the commit of the build shown, and the route, with the sharer's workspace,
 * whose comments it shows. Only the token's digest is stored.
 */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** An application's own route: a path from its root, without control characters. */
export const routeSchema = z
  .string()
  .max(2048)
  .regex(/^\/[^\s\p{Cc}]*$/u);

export const commitSchema = z.string().regex(/^[0-9a-f]{40}$/);

export const shareInputSchema = z.strictObject({ commit: commitSchema, route: routeSchema });
export type ShareInput = z.infer<typeof shareInputSchema>;

export interface Share {
  readonly applicationId: number;
  /** The sharer's workspace, whose comments the link shows. */
  readonly viewWorkspaceId: number;
  /** The commit of the build the sharer was looking at. */
  readonly commit: string;
  readonly route: string;
}

function isShareToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** Stores a share link to a view of +applicationId+ and returns its token, which is never stored. */
export function createShare(db: Executor, applicationId: number, viewWorkspaceId: number, input: ShareInput, now = new Date()): string {
  const { commit, route } = shareInputSchema.parse(input);
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64Url(bytes);
  db.insert(demoShares).values({ tokenDigest: keyDigest(token), applicationId, viewWorkspaceId, commitSha: commit, route, createdAt: now }).run();
  return token;
}

/** The share link +token+ opens, or null when it never existed, its workspace was reset, or its application was deleted. */
export function findShare(db: Executor, token: string | undefined | null): Share | null {
  if (!isShareToken(token)) return null;
  const row = db.select().from(demoShares).where(eq(demoShares.tokenDigest, keyDigest(token))).get();
  return row ? { applicationId: row.applicationId, viewWorkspaceId: row.viewWorkspaceId, commit: row.commitSha, route: row.route } : null;
}
