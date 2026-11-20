import { applicationsUnavailable } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { attempt, jsonBody, stringField, writableView } from "@/lib/workspaces/api";
import { listThreads, setThreadStatus } from "@/lib/workspaces/comments";

/** Resolves or reopens a thread in the visitor's view of a running application, or the shared view they opened. */
export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  // Availability comes first, so it answers not found whatever the body.
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const status = stringField(body, "status", 20);
  if (status !== "open" && status !== "resolved") return Response.json({ error: "Unknown status" }, { status: 400 });
  const resolved = await writableView(request);
  if (resolved instanceof Response) return resolved;
  const { threadId } = await params;
  return attempt(() => {
    const db = getDb();
    setThreadStatus(db, resolved.view, threadId, status);
    return Response.json({ threads: listThreads(db, resolved.view), displayName: resolved.workspace.displayName });
  });
}
