import { applicationsUnavailable } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { errorsFrom } from "@/lib/web/form-data";
import { type ApplicationView, resolveApplicationView, viewedApplication } from "./access";
import { currentWorkspace, writableWorkspace } from "./request";
import { DemoLimitError, type Workspace } from "./workspaces";

/**
 * Shared plumbing for the workspace's JSON route handlers on running
 * applications (src/app/api/workspace): availability, view authorization
 * (the visitor's own view of the application the request's `application`
 * query names, or a share link's, from its `share` query), and bounded JSON
 * bodies. Each answers not found while applications aren't offered.
 */

const BODY_LIMIT = 16 * 1024;

export const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

function invalid(error: ValidationError): Response {
  return Response.json({ errors: errorsFrom(error) }, { status: 400 });
}

/** The application slug and share link token a request names. */
function viewQuery(request: Request): { slug: string; share: string | null } {
  const query = new URL(request.url).searchParams;
  return { slug: query.get("application") ?? "", share: query.get("share") };
}

/** The view a request may read, or a response that refuses it. */
export async function readableView(request: Request): Promise<{ view: ApplicationView; workspace: Workspace | null } | Response> {
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  const db = getDb();
  const { slug, share } = viewQuery(request);
  const application = viewedApplication(db, slug);
  if (!application) return notFound();
  const workspace = await currentWorkspace();
  return { view: resolveApplicationView(db, application, workspace, share), workspace };
}

/** The view a request may write to, creating the visitor's workspace on first use. */
export async function writableView(request: Request): Promise<{ view: ApplicationView & { viewWorkspaceId: number }; workspace: Workspace } | Response> {
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  const db = getDb();
  const { slug, share } = viewQuery(request);
  const application = viewedApplication(db, slug);
  if (!application) return notFound();
  const workspace = await writableWorkspace();
  const view = resolveApplicationView(db, application, workspace, share);
  if (view.viewWorkspaceId === null) return notFound();
  return { view: view as ApplicationView & { viewWorkspaceId: number }, workspace };
}

/** Reads a JSON object body of at most 16 KB. */
export async function jsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  const text = await request.text();
  if (text.length > BODY_LIMIT) return Response.json({ error: "Request too large" }, { status: 413 });
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Falls through to the error below.
  }
  return Response.json({ error: "Expected a JSON object" }, { status: 400 });
}

/** Runs a write, turning validation problems and workspace limits into a 400 response. */
export function attempt(work: () => Response): Response {
  try {
    return work();
  } catch (error) {
    if (error instanceof ValidationError) return invalid(error);
    if (error instanceof DemoLimitError) return Response.json({ errors: { body: [error.message] } }, { status: 400 });
    throw error;
  }
}

export function stringField(body: Record<string, unknown>, name: string, max = 200): string {
  const value = body[name];
  return typeof value === "string" ? value.slice(0, max) : "";
}
