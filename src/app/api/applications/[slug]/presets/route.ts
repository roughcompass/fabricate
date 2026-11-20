import { applicationsUnavailable } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { attempt, fromOwnOrigin, jsonBody, notFound } from "@/lib/workspaces/api";
import { viewedApplication } from "@/lib/workspaces/access";
import { type PresetInput, type SessionPreset, StalePresetError, choosePreset, chosenPreset, createPreset, deletePreset, editPreset, listPresets } from "@/lib/workspaces/presets";
import { currentWorkspace, writableWorkspace } from "@/lib/workspaces/request";

/*
 * An application's session presets (restore-toolbar-tools-and-branch-
 * previews, design decision 8; template-demo/session-presets spec). They're
 * the application's, so any visitor with a workspace, on the Frontend
 * Registry's own origin, can list, create, edit, and delete them, and the
 * workspace's display name is recorded as the last to change one. Each
 * visitor's choice is their workspace's own.
 *
 * - GET: the presets, and the visitor's choice.
 * - POST `{ name, entries }`: creates one.
 * - PATCH `?preset=<id>`, `{ name, entries, lockVersion }`: edits one; 409,
 *   with the preset as it stands, when someone else changed it first.
 * - DELETE `?preset=<id>`: deletes one for everyone.
 * - PUT `{ preset }`: the preset the visitor's workspace starts the
 *   application with, or null for its own storage.
 *
 * Not found while previews are off or for an unknown application; 403 for a
 * change from another origin.
 */

const forbidden = () => Response.json({ error: "Changes come only from the Frontend Registry's own pages" }, { status: 403 });

const shown = (preset: SessionPreset) => ({ ...preset, createdAt: preset.createdAt.toISOString(), updatedAt: preset.updatedAt.toISOString() });

/** The application the request's address names, or a response that refuses it. */
async function application(ctx: RouteContext<"/api/applications/[slug]/presets">) {
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  const found = viewedApplication(getDb(), (await ctx.params).slug);
  return found ?? notFound();
}

/** A preset's name and entries from a request's body, as strings. */
function input(body: Record<string, unknown>): PresetInput {
  const entries = Array.isArray(body.entries) ? body.entries : [];
  return {
    name: typeof body.name === "string" ? body.name : "",
    entries: entries.map((entry) => {
      const raw = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      return { store: String(raw.store ?? ""), name: typeof raw.name === "string" ? raw.name : "", value: typeof raw.value === "string" ? raw.value : "" };
    }),
  };
}

export async function GET(_request: Request, ctx: RouteContext<"/api/applications/[slug]/presets">) {
  const found = await application(ctx);
  if (found instanceof Response) return found;
  const db = getDb();
  const workspace = await currentWorkspace();
  return Response.json({ presets: listPresets(db, found.id).map(shown), chosen: chosenPreset(db, workspace?.id ?? null, found.id)?.publicId ?? null }, { headers: { "Cache-Control": "no-store" } });
}

interface ChangeContext {
  readonly db: ReturnType<typeof getDb>;
  readonly applicationId: number;
  readonly workspace: { readonly id: number; readonly displayName: string | null };
}

/** Runs a change for the visitor's workspace, answering with the preset it made or changed, the application's presets, and the visitor's choice. */
async function change(request: Request, ctx: RouteContext<"/api/applications/[slug]/presets">, work: (body: Record<string, unknown>, context: ChangeContext) => { status?: number; preset?: SessionPreset | null }): Promise<Response> {
  const found = await application(ctx);
  if (found instanceof Response) return found;
  if (!fromOwnOrigin(request)) return forbidden();
  const body = request.method === "DELETE" ? {} : await jsonBody(request);
  if (body instanceof Response) return body;
  let workspace: ChangeContext["workspace"];
  try {
    workspace = await writableWorkspace();
  } catch {
    return Response.json({ errors: { base: ["This browser has no workspace yet. Reload the page and try again."] } }, { status: 400 });
  }
  const db = getDb();
  return attempt(() => {
    try {
      const result = work(body, { db, applicationId: found.id, workspace });
      return Response.json({ preset: result.preset ? shown(result.preset) : null, presets: listPresets(db, found.id).map(shown), chosen: chosenPreset(db, workspace.id, found.id)?.publicId ?? null }, { status: result.status ?? 200 });
    } catch (error) {
      if (error instanceof StalePresetError) return Response.json({ errors: { base: [error.message] }, preset: shown(error.current) }, { status: 409 });
      if (error instanceof NotFoundError) return Response.json({ errors: { base: [error.message] } }, { status: 404 });
      throw error;
    }
  });
}

export function POST(request: Request, ctx: RouteContext<"/api/applications/[slug]/presets">) {
  return change(request, ctx, (body, { db, applicationId, workspace }) => ({ status: 201, preset: createPreset(db, applicationId, input(body), workspace.displayName) }));
}

export function PATCH(request: Request, ctx: RouteContext<"/api/applications/[slug]/presets">) {
  const id = new URL(request.url).searchParams.get("preset") ?? "";
  return change(request, ctx, (body, { db, applicationId, workspace }) => ({ preset: editPreset(db, applicationId, id, Number(body.lockVersion), input(body), workspace.displayName) }));
}

export function DELETE(request: Request, ctx: RouteContext<"/api/applications/[slug]/presets">) {
  const id = new URL(request.url).searchParams.get("preset") ?? "";
  return change(request, ctx, (_body, { db, applicationId }) => {
    if (!deletePreset(db, applicationId, id)) throw new NotFoundError("That preset no longer exists. Someone else deleted it.");
    return {};
  });
}

export function PUT(request: Request, ctx: RouteContext<"/api/applications/[slug]/presets">) {
  return change(request, ctx, (body, { db, applicationId, workspace }) => ({ preset: choosePreset(db, workspace.id, applicationId, typeof body.preset === "string" ? body.preset : null) }));
}
