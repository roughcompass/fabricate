import { eq } from "drizzle-orm";
import { z } from "zod";
import type { JsonObject } from "@repo-facts/contract";
import type { Executor } from "@/lib/db/client";
import { applicationPreviews, shareLinks } from "@/lib/db/schema";
import { base64Url } from "./workspace-key";
import { keyDigest } from "./workspaces";

/**
 * Share links to a view of a running application (template-demo/toolbar
 * spec, "Visitors can share an application view"; add-applications, design
 * decision 7). A link carries a random token and captures the application,
 * the commit of the build shown, and the route, with the sharer's workspace,
 * whose comments it shows. It also captures the saved preview shown, with
 * its ref as it was then, and the view: the Salt theme, the Microfrontends
 * routing, and the chosen session preset's ID and name, never its entries
 * (restore-toolbar-tools-and-branch-previews, design decision 5). Only the
 * token's digest is stored.
 */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** An application's own route: a path from its root, without control characters. */
export const routeSchema = z
  .string()
  .max(2048)
  .regex(/^\/[^\s\p{Cc}]*$/u);

export const commitSchema = z.string().regex(/^[0-9a-f]{40}$/);

const KEY = /^[a-z0-9.-]{1,60}$/;
const SLUG = /^[a-z0-9-]{1,80}$/;

/** The Salt theme the sharer chose in Settings; each choice left out keeps the application's own. */
export const shareThemeSchema = z.strictObject({
  mode: z.enum(["light", "dark"]).optional(),
  density: z.enum(["high", "medium", "low", "touch"]).optional(),
  accent: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).optional(),
  corner: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).optional(),
});

/**
 * One microfrontend the sharer routed to another build: the remote or
 * import-map specifier, how it's loaded, the address the page requests as
 * built, and the build it's routed to, by its application's slug, the saved
 * preview's key when it's one, and the build's preview ID.
 */
export const shareRouteSchema = z.strictObject({
  remote: z.string().min(1).max(214),
  mechanism: z.enum(["module-federation", "import-map"]),
  from: z.string().min(1).max(2048),
  target: z.strictObject({ application: z.string().regex(SLUG), preview: z.string().regex(KEY).optional(), build: z.string().regex(/^pvw_[a-z0-9]{16}$/) }),
});

/** The chosen session preset, by its public ID and its name then; never its entries. */
export const shareSessionSchema = z.strictObject({ preset: z.string().regex(/^ses_[a-z0-9]{16}$/), name: z.string().min(1).max(60) });

/** What a share link applies besides its build and route (design decision 5): `{ theme?, routing?, session? }`. */
export const shareViewSchema = z.strictObject({ theme: shareThemeSchema.optional(), routing: z.array(shareRouteSchema).max(50).optional(), session: shareSessionSchema.optional() });
export type ShareView = z.infer<typeof shareViewSchema>;

/** What the toolbar sends: the commit, the route, and the theme and routing it shows. The session preset is recorded on the server, from the visitor's choice. */
export const shareInputSchema = z.strictObject({ commit: commitSchema, route: routeSchema, view: shareViewSchema.omit({ session: true }).optional() });
export type ShareInput = z.infer<typeof shareInputSchema>;

export interface Share {
  readonly applicationId: number;
  /** The sharer's workspace, whose comments the link shows. */
  readonly viewWorkspaceId: number;
  /** The commit of the build the sharer was looking at. */
  readonly commit: string;
  readonly route: string;
  /** The saved preview shown, by its row id and key while it's saved, and its ref when the link was made; null for the tracked branch. */
  readonly preview: { readonly id: number | null; readonly key: string | null; readonly ref: string } | null;
  readonly view: ShareView;
}

/** What createShare records besides the toolbar's input: the saved preview shown, and the chosen session preset. */
export interface ShareContext {
  readonly preview?: { readonly id: number; readonly ref: string } | null;
  readonly session?: z.infer<typeof shareSessionSchema> | null;
}

function isShareToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** Stores a share link to a view of +applicationId+, with the saved preview and session preset of +context+, and returns its token, which is never stored. */
export function createShare(db: Executor, applicationId: number, viewWorkspaceId: number, input: ShareInput, now = new Date(), context: ShareContext = {}): string {
  const { commit, route, view = {} } = shareInputSchema.parse(input);
  const stored = shareViewSchema.parse({ ...view, ...(context.session && { session: context.session }) });
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64Url(bytes);
  db.insert(shareLinks)
    .values({ tokenDigest: keyDigest(token), applicationId, viewWorkspaceId, commitSha: commit, route, applicationPreviewId: context.preview?.id ?? null, previewRef: context.preview?.ref ?? null, view: stored as JsonObject, createdAt: now })
    .run();
  return token;
}

/** The share link +token+ opens, or null when it never existed, its workspace was reset, or its application was deleted. */
export function findShare(db: Executor, token: string | undefined | null): Share | null {
  if (!isShareToken(token)) return null;
  const found = db.select({ row: shareLinks, key: applicationPreviews.key }).from(shareLinks).leftJoin(applicationPreviews, eq(applicationPreviews.id, shareLinks.applicationPreviewId)).where(eq(shareLinks.tokenDigest, keyDigest(token))).get();
  if (!found) return null;
  const { row, key } = found;
  // A view written by a later release, or by hand, that this one can't read applies nothing rather than fail.
  const view = shareViewSchema.safeParse(row.view);
  return {
    applicationId: row.applicationId,
    viewWorkspaceId: row.viewWorkspaceId,
    commit: row.commitSha,
    route: row.route,
    preview: row.previewRef ? { id: row.applicationPreviewId, key: key ?? null, ref: row.previewRef } : null,
    view: view.success ? view.data : {},
  };
}
