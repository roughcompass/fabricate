import { getDb } from "@/lib/db/client";
import { jsonBody, stringField, writableView } from "@/lib/demo/api";
import { createShare, shareStateSchema } from "@/lib/demo/shares";

/** Creates a share link to the visitor's current view, capturing its route, overrides, theme, and persona. */
export async function POST(request: Request) {
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const resolved = await writableView(stringField(body, "application", 80));
  if (resolved instanceof Response) return resolved;
  const state = shareStateSchema.safeParse(body.state);
  if (!state.success) return Response.json({ error: "Invalid view state" }, { status: 400 });
  const { view } = resolved;
  const target = view.target.kind === "application" ? { applicationId: view.target.application.id } : { referenceSlug: view.target.template.slug };
  const token = createShare(getDb(), target, view.viewWorkspaceId, state.data);
  return Response.json({ path: `/s/${token}` }, { status: 201 });
}
