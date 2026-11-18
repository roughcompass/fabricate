import { getDb } from "@/lib/db/client";
import { jsonBody, stringField, writableView } from "@/lib/demo/api";
import { demoUnavailable } from "@/lib/demo/guard";
import { createShare, shareStateSchema } from "@/lib/demo/shares";

/** Creates a share link to the visitor's current view, capturing its route, overrides, theme, and session profile. */
export async function POST(request: Request) {
  // The demo switch comes first, so a disabled demo answers not found whatever the body.
  const unavailable = demoUnavailable();
  if (unavailable) return unavailable;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const resolved = await writableView(stringField(body, "application", 80));
  if (resolved instanceof Response) return resolved;
  const state = shareStateSchema.safeParse(body.state);
  if (!state.success) return Response.json({ error: "Invalid view state" }, { status: 400 });
  const { view } = resolved;
  const token = createShare(getDb(), view.template.slug, view.viewWorkspaceId, state.data);
  return Response.json({ path: `/s/${token}` }, { status: 201 });
}
