import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type Executor, immediate } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type ThreadStatus, demoComments, demoThreads } from "@/lib/db/schema";
import { type DemoView, viewTemplate } from "./access";
import { memberById, routeByPath } from "./catalog";
import { COMMENT_LIMIT, normalizeDisplayName } from "./workspaces";

/**
 * Comment threads anchored to rendered elements (template-demo/toolbar spec).
 * Every operation is scoped to one view: a thread belongs to an application
 * (or a reference deployment) as seen from one workspace, so a visitor never
 * reads or changes another view's threads. Bodies are stored as written,
 * Markdown markers included; comment-format.ts styles them only for display.
 */

export interface CommentRecord {
  readonly id: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface ThreadRecord {
  readonly id: string;
  readonly route: string;
  readonly member: string;
  readonly memberVersion: string;
  readonly anchor: string;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly status: ThreadStatus;
  readonly createdAt: string;
  readonly comments: readonly CommentRecord[];
}

export const threadInputSchema = z.strictObject({
  route: z.string().regex(/^[a-z0-9-]{1,40}$/),
  member: z.string().regex(/^[a-z0-9-]{1,60}$/),
  memberVersion: z.string().min(1).max(40),
  anchor: z.string().regex(/^[A-Za-z0-9_:.-]{1,120}$/),
  offsetX: z.number().min(0).max(1),
  offsetY: z.number().min(0).max(1),
  body: z.string(),
  authorName: z.string().optional(),
});

export type ThreadInput = z.infer<typeof threadInputSchema>;

/** A view with a workspace to write in: comments always belong to one. */
export type WritableView = DemoView & { readonly viewWorkspaceId: number };

export interface Author {
  readonly workspaceId: number;
  readonly name: string;
}

export function normalizeBody(value: string): string {
  const body = value.replace(/\r\n?/g, "\n").trim();
  if (!body) throw new ValidationError([{ field: "body", message: "Write a comment" }]);
  if (body.length > COMMENT_LIMIT) throw new ValidationError([{ field: "body", message: `Use at most ${COMMENT_LIMIT.toLocaleString("en-US")} characters` }]);
  return body;
}

export function authorName(stored: string | null, provided: string | undefined): string {
  if (provided !== undefined && provided.trim() !== "") return normalizeDisplayName(provided);
  if (stored) return stored;
  throw new ValidationError([{ field: "authorName", message: "Enter a display name" }]);
}

function targetColumns(view: DemoView) {
  return view.target.kind === "application" ? { applicationId: view.target.application.id, referenceSlug: null } : { applicationId: null, referenceSlug: view.target.template.slug };
}

function viewCondition(view: DemoView & { viewWorkspaceId: number }) {
  const target = view.target.kind === "application" ? eq(demoThreads.applicationId, view.target.application.id) : eq(demoThreads.referenceSlug, view.target.template.slug);
  return and(target, eq(demoThreads.viewWorkspaceId, view.viewWorkspaceId));
}

/** Every thread in a view, oldest first, with its comments. */
export function listThreads(db: Executor, view: DemoView): ThreadRecord[] {
  if (view.viewWorkspaceId === null) return [];
  const threads = db.select().from(demoThreads).where(viewCondition(view as WritableView)).orderBy(asc(demoThreads.createdAt), asc(demoThreads.id)).all();
  if (!threads.length) return [];
  const comments = db
    .select()
    .from(demoComments)
    .where(inArray(demoComments.threadId, threads.map((thread) => thread.id)))
    .orderBy(asc(demoComments.createdAt), asc(demoComments.id))
    .all();
  return threads.map((thread) => ({
    id: thread.publicId,
    route: thread.route,
    member: thread.member,
    memberVersion: thread.memberVersion,
    anchor: thread.anchor,
    offsetX: thread.offsetX,
    offsetY: thread.offsetY,
    status: thread.status,
    createdAt: thread.createdAt.toISOString(),
    comments: comments
      .filter((comment) => comment.threadId === thread.id)
      .map((comment) => ({ id: comment.publicId, authorName: comment.authorName, body: comment.body, createdAt: comment.createdAt.toISOString() })),
  }));
}

/** Starts a thread on an element in the view, with its first comment. */
export function createThread(db: Executor, view: WritableView, author: Author, input: ThreadInput, now = new Date()): string {
  const template = viewTemplate(view.target);
  if (!template) throw new ValidationError([{ field: "application", message: "This application's template no longer exists" }]);
  const member = memberById(template.app, input.member);
  const issues = [];
  if (!routeByPath(template.app, input.route)) issues.push({ field: "route", message: "This route is not part of the application" });
  if (!member) issues.push({ field: "member", message: "This microfrontend is not part of the application" });
  else if (!member.versions.some((version) => version.version === input.memberVersion)) issues.push({ field: "memberVersion", message: "This version is not available" });
  if (issues.length) throw new ValidationError(issues);
  const body = normalizeBody(input.body);
  return immediate(db, (tx) => {
    const thread = tx
      .insert(demoThreads)
      .values({
        publicId: generatePublicId("thr"),
        ...targetColumns(view),
        viewWorkspaceId: view.viewWorkspaceId,
        route: input.route,
        member: input.member,
        memberVersion: input.memberVersion,
        anchor: input.anchor,
        offsetX: input.offsetX,
        offsetY: input.offsetY,
        createdAt: now,
      })
      .returning()
      .get();
    tx.insert(demoComments).values({ publicId: generatePublicId("cmt"), threadId: thread.id, authorWorkspaceId: author.workspaceId, authorName: author.name, body, createdAt: now }).run();
    return thread.publicId;
  });
}

function threadInView(db: Executor, view: WritableView, threadId: string) {
  const thread = db.select().from(demoThreads).where(and(eq(demoThreads.publicId, threadId), viewCondition(view))).get();
  if (!thread) throw new ValidationError([{ field: "thread", message: "This comment thread does not exist" }]);
  return thread;
}

export function addComment(db: Executor, view: WritableView, threadId: string, author: Author, value: string, now = new Date()): void {
  const body = normalizeBody(value);
  const thread = threadInView(db, view, threadId);
  db.insert(demoComments).values({ publicId: generatePublicId("cmt"), threadId: thread.id, authorWorkspaceId: author.workspaceId, authorName: author.name, body, createdAt: now }).run();
}

export function setThreadStatus(db: Executor, view: WritableView, threadId: string, status: ThreadStatus, now = new Date()): void {
  const thread = threadInView(db, view, threadId);
  db.update(demoThreads)
    .set({ status, resolvedAt: status === "resolved" ? now : null })
    .where(eq(demoThreads.id, thread.id))
    .run();
}
