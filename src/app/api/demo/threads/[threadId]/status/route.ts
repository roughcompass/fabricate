import { getDb } from "@/lib/db/client";
import { attempt, jsonBody, stringField, writableView } from "@/lib/demo/api";
import { listThreads, setThreadStatus } from "@/lib/demo/comments";

/** Resolves or reopens a thread in the visitor's view. */
export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const status = stringField(body, "status", 20);
  if (status !== "open" && status !== "resolved") return Response.json({ error: "Expected open or resolved" }, { status: 400 });
  const resolved = await writableView(stringField(body, "application", 80));
  if (resolved instanceof Response) return resolved;
  const { threadId } = await params;
  return attempt(() => {
    const db = getDb();
    setThreadStatus(db, resolved.view, threadId, status);
    return Response.json({ threads: listThreads(db, resolved.view) });
  });
}
