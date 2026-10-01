import { getDb } from "@/lib/db/client";
import { attempt, jsonBody, readableView, stringField, writableView } from "@/lib/demo/api";
import { authorName, createThread, listThreads, threadInputSchema } from "@/lib/demo/comments";
import { demoUnavailable } from "@/lib/demo/guard";
import { setDisplayName } from "@/lib/demo/workspaces";

/** The comment threads of the view the visitor may open, with their display name. */
export async function GET(request: Request) {
  const application = new URL(request.url).searchParams.get("application") ?? "";
  const resolved = await readableView(application);
  if (resolved instanceof Response) return resolved;
  return Response.json({ threads: listThreads(getDb(), resolved.view), displayName: resolved.workspace?.displayName ?? null });
}

/** Starts a thread on a rendered element, with its first comment. */
export async function POST(request: Request) {
  // The demo switch comes first, so a disabled demo answers not found whatever the body.
  const unavailable = demoUnavailable();
  if (unavailable) return unavailable;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const resolved = await writableView(stringField(body, "application", 80));
  if (resolved instanceof Response) return resolved;
  const { application: _application, ...rest } = body;
  const parsed = threadInputSchema.safeParse({ ...rest, body: stringField(body, "body", 4000), authorName: body.authorName === undefined ? undefined : stringField(body, "authorName", 200) });
  if (!parsed.success) return Response.json({ error: "Invalid thread" }, { status: 400 });
  return attempt(() => {
    const db = getDb();
    const name = authorName(resolved.workspace.displayName, parsed.data.authorName);
    if (name !== resolved.workspace.displayName) setDisplayName(db, resolved.workspace.id, name);
    const id = createThread(db, resolved.view, { workspaceId: resolved.workspace.id, name }, parsed.data);
    return Response.json({ id, threads: listThreads(db, resolved.view), displayName: name }, { status: 201 });
  });
}
