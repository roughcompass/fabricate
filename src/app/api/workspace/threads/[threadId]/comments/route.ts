import { applicationsUnavailable } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { attempt, jsonBody, stringField, writableView } from "@/lib/demo/api";
import { addComment, authorName, listThreads } from "@/lib/demo/comments";
import { setDisplayName } from "@/lib/demo/workspaces";

/** Replies to a thread in the visitor's view of a running application, or the shared view they opened. */
export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  // Availability comes first, so it answers not found whatever the body.
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const resolved = await writableView(request);
  if (resolved instanceof Response) return resolved;
  const { threadId } = await params;
  return attempt(() => {
    const db = getDb();
    const name = authorName(resolved.workspace.displayName, body.authorName === undefined ? undefined : stringField(body, "authorName", 200));
    if (name !== resolved.workspace.displayName) setDisplayName(db, resolved.workspace.id, name);
    addComment(db, resolved.view, threadId, { workspaceId: resolved.workspace.id, name }, stringField(body, "body", 4000));
    return Response.json({ threads: listThreads(db, resolved.view), displayName: name }, { status: 201 });
  });
}
