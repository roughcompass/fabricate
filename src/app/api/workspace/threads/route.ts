import { applicationsUnavailable } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { attempt, jsonBody, readableView, stringField, writableView } from "@/lib/demo/api";
import { authorName, createThread, listThreads, threadInputSchema } from "@/lib/demo/comments";
import { setDisplayName } from "@/lib/demo/workspaces";

/**
 * The comment threads of the view of a running application the visitor may
 * open, with their display name: `?application=<slug>`, and `&share=<token>`
 * for a shared view.
 */
export async function GET(request: Request) {
  const resolved = await readableView(request);
  if (resolved instanceof Response) return resolved;
  return Response.json({ threads: listThreads(getDb(), resolved.view), displayName: resolved.workspace?.displayName ?? null });
}

/** Starts a thread on one of the application's elements, at its route and commit, with its first comment. */
export async function POST(request: Request) {
  // Availability comes first, so it answers not found whatever the body.
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const resolved = await writableView(request);
  if (resolved instanceof Response) return resolved;
  const parsed = threadInputSchema.safeParse({ ...body, body: stringField(body, "body", 4000), authorName: body.authorName === undefined ? undefined : stringField(body, "authorName", 200) });
  if (!parsed.success) return Response.json({ error: "Invalid thread" }, { status: 400 });
  return attempt(() => {
    const db = getDb();
    const name = authorName(resolved.workspace.displayName, parsed.data.authorName);
    if (name !== resolved.workspace.displayName) setDisplayName(db, resolved.workspace.id, name);
    const id = createThread(db, resolved.view, { workspaceId: resolved.workspace.id, name }, parsed.data);
    return Response.json({ id, threads: listThreads(db, resolved.view), displayName: name }, { status: 201 });
  });
}
