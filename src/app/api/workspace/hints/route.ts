import { applicationsUnavailable } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { jsonBody, stringField } from "@/lib/demo/api";
import { writableWorkspace } from "@/lib/demo/request";
import { isHintAction, isHintSequence, nextHints } from "@/lib/demo/hints";
import { setHints } from "@/lib/demo/workspaces";

/**
 * Updates the visitor's guided-hint state (template-demo/demo-mode spec):
 * finish or dismiss a sequence, replay it, or turn hints off or on. Hints
 * belong to running applications, so this answers only while applications are
 * offered.
 */
export async function POST(request: Request) {
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const action = stringField(body, "action", 20);
  const sequence = stringField(body, "sequence", 20);
  if (!isHintAction(action)) return Response.json({ error: "Unknown action" }, { status: 400 });
  if (action === "done" && !isHintSequence(sequence)) return Response.json({ error: "Unknown hint sequence" }, { status: 400 });
  const workspace = await writableWorkspace();
  const next = nextHints(workspace.hints, action, isHintSequence(sequence) ? sequence : undefined)!;
  return Response.json({ hints: setHints(getDb(), workspace.id, next) });
}
