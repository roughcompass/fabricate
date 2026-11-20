import { applicationsUnavailable } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { jsonBody, writableView } from "@/lib/workspaces/api";
import { createShare, shareInputSchema } from "@/lib/workspaces/shares";

/**
 * Creates a share link to the view of a running application the visitor has
 * open (template-demo/toolbar spec, "Visitors can share an application
 * view"): the application, the saved preview shown (`&preview=<key>`), the
 * commit of the build shown, the route, and the view's theme and routing
 * (`view` in the body), with the view's comments. A link made from a shared
 * view shares that view.
 */
export async function POST(request: Request) {
  // Availability comes first, so it answers not found whatever the body.
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const input = shareInputSchema.safeParse(body);
  if (!input.success) return Response.json({ error: "Invalid view" }, { status: 400 });
  const resolved = await writableView(request);
  if (resolved instanceof Response) return resolved;
  const token = createShare(getDb(), resolved.view.application.id, resolved.view.viewWorkspaceId, input.data, undefined, { preview: resolved.view.preview ?? null });
  return Response.json({ path: `/s/${token}` }, { status: 201 });
}
