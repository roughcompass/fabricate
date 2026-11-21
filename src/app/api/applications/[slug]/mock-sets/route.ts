import { getDb } from "@/lib/db/client";
import { chosenSet, resolveActiveSet } from "@/lib/mocks/active";
import { NO_STORE, jsonObject, mockApplication, mockChange, requestedView, setInputFrom, shownSet } from "@/lib/mocks/api";
import { createSet, editSet, listSets } from "@/lib/mocks/records";
import { currentWorkspace } from "@/lib/workspaces/request";

/*
 * An application's mock sets (add-mock-sets, design decisions 14 and 15,
 * task 4.2). They're the application's, so any visitor reads them, and any
 * visitor with a workspace, on the Frontend Registry's own origin, creates
 * and edits them, recorded with the workspace's display name.
 *
 * - GET `?preview=<key>&share=<token>`: the sets, by name, each with its
 *   default mark; the view's active set and where it came from; and the
 *   visitor's own choice for the view, if any.
 * - POST `{ name, description?, hostMode?, hosts?, unmatched? }`: creates an
 *   empty set; 201.
 * - PATCH `?set=<id>`, `{ …, lockVersion }`: edits a set's settings; 409,
 *   with the set as it stands, when someone else changed them first.
 *
 * Not found while previews are off, for an unknown application, and for a
 * saved preview it doesn't have; 403 for a change from another origin.
 */

export async function GET(request: Request, ctx: RouteContext<"/api/applications/[slug]/mock-sets">) {
  const application = mockApplication((await ctx.params).slug);
  if (application instanceof Response) return application;
  const view = requestedView(request, application);
  if (view instanceof Response) return view;
  const db = getDb();
  const workspace = await currentWorkspace();
  const chosen = chosenSet(db, workspace?.id ?? null, application.id, view.previewId);
  return Response.json(
    {
      sets: listSets(db, application.id).map((set) => ({ ...shownSet(set), isDefault: set.isDefault })),
      active: resolveActiveSet(db, { applicationId: application.id, previewId: view.previewId, workspaceId: workspace?.id ?? null, shared: view.shared }),
      chosen: chosen ? { set: chosen.set?.publicId ?? null } : null,
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request, ctx: RouteContext<"/api/applications/[slug]/mock-sets">) {
  const application = mockApplication((await ctx.params).slug);
  if (application instanceof Response) return application;
  const body = await jsonObject(request);
  if (body instanceof Response) return body;
  return mockChange(request, (workspace) => Response.json({ set: shownSet(createSet(getDb(), application.id, { ...setInputFrom(body), source: "written" }, workspace.displayName)) }, { status: 201, headers: NO_STORE }));
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/applications/[slug]/mock-sets">) {
  const application = mockApplication((await ctx.params).slug);
  if (application instanceof Response) return application;
  const body = await jsonObject(request);
  if (body instanceof Response) return body;
  const set = new URL(request.url).searchParams.get("set") ?? "";
  return mockChange(request, (workspace) => Response.json({ set: shownSet(editSet(getDb(), application.id, set, Number(body.lockVersion), setInputFrom(body), workspace.displayName)) }, { headers: NO_STORE }));
}
