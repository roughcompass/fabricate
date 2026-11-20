import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatNumber } from "@/components/ui/count";
import { type Executor, immediate } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type ThreadStatus, threadComments, commentThreads } from "@/lib/db/schema";
import type { ApplicationView } from "./access";
import { commitSchema, routeSchema } from "./shares";
import { COMMENT_LIMIT, WorkspaceLimitError, THREAD_LIMIT, normalizeDisplayName } from "./workspaces";

/**
 * Comment threads on a running application's elements (template-demo/toolbar
 * spec, "Comments stay bound to their element, route, and commit";
 * add-applications, design decision 7). Every operation is scoped to one
 * view: an application as seen from one workspace, so a visitor never reads
 * or changes another view's threads. A thread records the route and the
 * commit of the build it was placed on, and the element by its anchor: a CSS
 * path, its tag, and a fingerprint of its text. Bodies are stored as
 * written, Markdown markers included; comment-format.ts styles them only for
 * display.
 */

interface CommentRecord {
  readonly id: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
}

export const anchorSchema = z.strictObject({
  path: z.string().min(1).max(1000),
  tag: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  fingerprint: z.string().max(200),
});

export type Anchor = z.infer<typeof anchorSchema>;

/** A thread as the toolbar shows it (src/components/toolbar/comments/thread-store.ts). */
export interface ThreadRecord {
  readonly id: string;
  readonly route: string;
  readonly commit: string;
  readonly anchor: Anchor;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly status: ThreadStatus;
  readonly createdAt: string;
  readonly comments: readonly CommentRecord[];
}

export const threadInputSchema = z.strictObject({
  route: routeSchema,
  commit: commitSchema,
  anchor: anchorSchema,
  offsetX: z.number().min(0).max(1),
  offsetY: z.number().min(0).max(1),
  body: z.string(),
  authorName: z.string().optional(),
});

export type ThreadInput = z.infer<typeof threadInputSchema>;

/** A view with a workspace to write in: comments always belong to one. */
export type WritableView = ApplicationView & { readonly viewWorkspaceId: number };

export interface Author {
  readonly workspaceId: number;
  readonly name: string;
}

export function normalizeBody(value: string): string {
  const body = value.replace(/\r\n?/g, "\n").trim();
  if (!body) throw new ValidationError([{ field: "body", message: "Write a comment" }]);
  if (body.length > COMMENT_LIMIT) throw new ValidationError([{ field: "body", message: `Use at most ${formatNumber(COMMENT_LIMIT)} characters` }]);
  return body;
}

export function authorName(stored: string | null, provided: string | undefined): string {
  if (provided !== undefined && provided.trim() !== "") return normalizeDisplayName(provided);
  if (stored) return stored;
  throw new ValidationError([{ field: "authorName", message: "Enter a display name" }]);
}

function viewCondition(view: WritableView) {
  return and(eq(commentThreads.applicationId, view.application.id), eq(commentThreads.viewWorkspaceId, view.viewWorkspaceId));
}

/** Every thread in a view, oldest first, with its comments. */
export function listThreads(db: Executor, view: ApplicationView): ThreadRecord[] {
  if (view.viewWorkspaceId === null) return [];
  const threads = db.select().from(commentThreads).where(viewCondition(view as WritableView)).orderBy(asc(commentThreads.createdAt), asc(commentThreads.id)).all();
  if (!threads.length) return [];
  const comments = db
    .select()
    .from(threadComments)
    .where(inArray(threadComments.threadId, threads.map((thread) => thread.id)))
    .orderBy(asc(threadComments.createdAt), asc(threadComments.id))
    .all();
  return threads.map((thread) => ({
    id: thread.publicId,
    route: thread.route,
    commit: thread.commitSha,
    anchor: thread.anchor as Anchor,
    offsetX: thread.offsetX,
    offsetY: thread.offsetY,
    status: thread.status,
    createdAt: thread.createdAt.toISOString(),
    comments: comments
      .filter((comment) => comment.threadId === thread.id)
      .map((comment) => ({ id: comment.publicId, authorName: comment.authorName, body: comment.body, createdAt: comment.createdAt.toISOString() })),
  }));
}

/**
 * Starts a thread on an element in the view, with its first comment. A
 * workspace holds at most THREAD_LIMIT open threads (template-demo/demo-mode
 * spec, "Workspace comments are bounded"); resolving threads makes room.
 */
export function createThread(db: Executor, view: WritableView, author: Author, input: ThreadInput, now = new Date()): string {
  const body = normalizeBody(input.body);
  return immediate(db, (tx) => {
    assertRoomForThread(tx, view.viewWorkspaceId);
    const thread = tx
      .insert(commentThreads)
      .values({
        publicId: generatePublicId("thr"),
        applicationId: view.application.id,
        viewWorkspaceId: view.viewWorkspaceId,
        route: input.route,
        commitSha: input.commit,
        anchor: input.anchor,
        offsetX: input.offsetX,
        offsetY: input.offsetY,
        createdAt: now,
      })
      .returning()
      .get();
    tx.insert(threadComments).values({ publicId: generatePublicId("cmt"), threadId: thread.id, authorWorkspaceId: author.workspaceId, authorName: author.name, body, createdAt: now }).run();
    return thread.publicId;
  });
}

function threadInView(db: Executor, view: WritableView, threadId: string) {
  const thread = db.select().from(commentThreads).where(and(eq(commentThreads.publicId, threadId), viewCondition(view))).get();
  if (!thread) throw new ValidationError([{ field: "thread", message: "This comment thread does not exist" }]);
  return thread;
}

export function addComment(db: Executor, view: WritableView, threadId: string, author: Author, value: string, now = new Date()): void {
  const body = normalizeBody(value);
  const thread = threadInView(db, view, threadId);
  db.insert(threadComments).values({ publicId: generatePublicId("cmt"), threadId: thread.id, authorWorkspaceId: author.workspaceId, authorName: author.name, body, createdAt: now }).run();
}

/** Throws WorkspaceLimitError when the workspace +viewWorkspaceId+ already holds THREAD_LIMIT open threads, so no other can open. */
function assertRoomForThread(db: Executor, viewWorkspaceId: number): void {
  const open = db.select({ n: count() }).from(commentThreads).where(and(eq(commentThreads.viewWorkspaceId, viewWorkspaceId), eq(commentThreads.status, "open"))).get()!.n;
  if (open >= THREAD_LIMIT) throw new WorkspaceLimitError(`This workspace has ${formatNumber(THREAD_LIMIT)} open comment threads, the most it can hold. Resolve some threads, or reset the workspace from Applications, to start another.`);
}

/** Resolves or reopens a thread; reopening one counts against THREAD_LIMIT, as starting one does. */
export function setThreadStatus(db: Executor, view: WritableView, threadId: string, status: ThreadStatus, now = new Date()): void {
  immediate(db, (tx) => {
    const thread = threadInView(tx, view, threadId);
    if (status === "open" && thread.status !== "open") assertRoomForThread(tx, view.viewWorkspaceId);
    tx.update(commentThreads)
      .set({ status, resolvedAt: status === "resolved" ? now : null })
      .where(eq(commentThreads.id, thread.id))
      .run();
  });
}
