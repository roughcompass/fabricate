import { getDb } from "@/lib/db/client";
import { chooseSet, resolveActiveSet } from "@/lib/mocks/active";
import { NO_STORE, jsonObject, mockApplication, mockChange, requestedView } from "@/lib/mocks/api";

/*
 * The visitor's choice of mock set for one view (add-mock-sets, design
 * decision 14, task 4.2; mock-data spec, "Data chooses the mock set a view
 * uses"): PUT `?preview=<key>`, `{ set }`, a set's ID or null for None, the
 * application's own network. Only the caller's workspace's choice for that
 * view changes. Answers with the choice and the view's active set. Not found
 * as the sets' endpoint is, and for a set of another application.
 */

export async function PUT(request: Request, ctx: RouteContext<"/api/applications/[slug]/mock-sets/choice">) {
  const application = mockApplication((await ctx.params).slug);
  if (application instanceof Response) return application;
  const view = requestedView(request, application);
  if (view instanceof Response) return view;
  const body = await jsonObject(request, 4096);
  if (body instanceof Response) return body;
  const set = typeof body.set === "string" ? body.set : null;
  return mockChange(request, (workspace) => {
    const db = getDb();
    const chosen = chooseSet(db, workspace.id, application.id, view.previewId, set);
    return Response.json({ chosen: { set: chosen?.publicId ?? null }, active: resolveActiveSet(db, { applicationId: application.id, previewId: view.previewId, workspaceId: workspace.id, shared: view.shared }) }, { headers: NO_STORE });
  });
}
