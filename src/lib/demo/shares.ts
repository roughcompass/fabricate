import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "@/lib/db/client";
import { demoShares } from "@/lib/db/schema";
import { ENVIRONMENTS } from "./catalog";
import { profileFieldsSchema } from "./profile-fields";
import { base64Url } from "./workspace-key";
import { keyDigest } from "./workspaces";

/**
 * Share links (template-demo/toolbar spec; design.md, decision 11). A link
 * carries a random token and captures one view's route, overrides, theme, and
 * session profile. Only the token's digest is stored.
 *
 * The profile is a snapshot of its name, persona, and region, which the
 * recipient sees without it joining their own profiles. `persona` stays the
 * id of the matching built-in profile: links from before profiles carry only
 * that, and open as that built-in profile (toolbar-updates design.md,
 * decision 7).
 */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const shareStateSchema = z.strictObject({
  route: z.string().regex(/^[a-z0-9-]{1,40}$/),
  overrides: z.record(z.string().regex(/^[a-z0-9-]{1,60}$/), z.strictObject({ version: z.string().min(1).max(40), environment: z.enum(ENVIRONMENTS) })),
  theme: z.enum(["light", "dark"]),
  persona: z.string().regex(/^[a-z-]{1,40}$/),
  profile: profileFieldsSchema.optional(),
});

export type ShareState = z.infer<typeof shareStateSchema>;

export type ShareTarget = { readonly applicationId: number } | { readonly referenceSlug: string };

export interface Share {
  readonly target: ShareTarget;
  readonly viewWorkspaceId: number;
  readonly state: ShareState;
}

export function isShareToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** Stores a share link for a view and returns its token, which is never stored. */
export function createShare(db: Executor, target: ShareTarget, viewWorkspaceId: number, state: ShareState, now = new Date()): string {
  const parsed = shareStateSchema.parse(state);
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64Url(bytes);
  db.insert(demoShares)
    .values({
      tokenDigest: keyDigest(token),
      applicationId: "applicationId" in target ? target.applicationId : null,
      referenceSlug: "referenceSlug" in target ? target.referenceSlug : null,
      viewWorkspaceId,
      state: JSON.stringify(parsed),
      createdAt: now,
    })
    .run();
  return token;
}

export function findShare(db: Executor, token: string | undefined | null): Share | null {
  if (!isShareToken(token)) return null;
  const row = db.select().from(demoShares).where(eq(demoShares.tokenDigest, keyDigest(token))).get();
  if (!row) return null;
  const state = shareStateSchema.safeParse(JSON.parse(row.state));
  if (!state.success) return null;
  const target: ShareTarget = row.applicationId !== null ? { applicationId: row.applicationId } : { referenceSlug: row.referenceSlug! };
  return { target, viewWorkspaceId: row.viewWorkspaceId, state: state.data };
}
