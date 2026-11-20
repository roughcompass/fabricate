import { applicationsUnavailable } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { jsonBody, writableView } from "@/lib/workspaces/api";
import { chosenPreset, findPreset, routeWithoutPreset } from "@/lib/workspaces/presets";
import { createShare, shareInputSchema } from "@/lib/workspaces/shares";

/**
 * Creates a share link to the view of a running application the visitor has
 * open (template-demo/toolbar spec, "Visitors can share an application
 * view"): the application, the saved preview shown (`&preview=<key>`), the
 * commit of the build shown, the route, and the view's theme and routing
 * (`view` in the body), with the view's comments. A link made from a shared
 * view shares that view.
 *
 * The session preset the view starts with, the visitor's choice or a shared
 * view's preset, is recorded here, by its ID and name, never its entries,
 * and its query parameters are left out of the captured route
 * (restore-toolbar-tools-and-branch-previews, design decision 8).
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
  const db = getDb();
  const applicationId = resolved.view.application.id;
  const shared = resolved.view.share?.view.session;
  const preset = shared ? findPreset(db, applicationId, shared.preset) : chosenPreset(db, resolved.workspace.id, applicationId);
  const view = preset ? { ...input.data, route: routeWithoutPreset(input.data.route, preset) } : input.data;
  const token = createShare(db, applicationId, resolved.view.viewWorkspaceId, view, undefined, { preview: resolved.view.preview ?? null, session: preset ? { preset: preset.publicId, name: preset.name } : null });
  return Response.json({ path: `/s/${token}` }, { status: 201 });
}
