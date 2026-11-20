import { applicationsUnavailable } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { errorsFrom } from "@/lib/web/form-data";
import { type ApplicationView, type ViewedApplication, type ViewedPreview, resolveApplicationView, viewedApplication, viewedPreview } from "./access";
import { currentWorkspace, writableWorkspace } from "./request";
import { WorkspaceLimitError, type Workspace } from "./workspaces";

/**
 * Shared plumbing for the workspace's JSON route handlers on running
 * applications (src/app/api/workspace): availability, view authorization
 * (the visitor's own view of the application the request's `application`
 * query names, or a share link's, from its `share` query, showing the saved
 * preview its `preview` query names by its key, if any), and bounded JSON
 * bodies. Each answers not found while applications aren't offered, and for
 * a saved preview the application doesn't have.
 */

const BODY_LIMIT = 16 * 1024;

export const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

function invalid(error: ValidationError): Response {
  return Response.json({ errors: errorsFrom(error) }, { status: 400 });
}

/** The application slug, saved preview key, and share link token a request names. */
function viewQuery(request: Request): { slug: string; preview: string | null; share: string | null } {
  const query = new URL(request.url).searchParams;
  return { slug: query.get("application") ?? "", preview: query.get("preview"), share: query.get("share") };
}

/** The saved preview +key+ names, null for none, or undefined when the application has no such preview. */
function previewOf(application: ViewedApplication, key: string | null): ViewedPreview | null | undefined {
  if (key === null) return null;
  return viewedPreview(getDb(), application, key) ?? undefined;
}

/** The view a request may read, or a response that refuses it. */
export async function readableView(request: Request): Promise<{ view: ApplicationView; workspace: Workspace | null } | Response> {
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  const db = getDb();
  const { slug, preview: key, share } = viewQuery(request);
  const application = viewedApplication(db, slug);
  const preview = application && previewOf(application, key);
  if (!application || preview === undefined) return notFound();
  const workspace = await currentWorkspace();
  return { view: resolveApplicationView(db, application, workspace, share, preview), workspace };
}

/** The view a request may write to, creating the visitor's workspace on first use. */
export async function writableView(request: Request): Promise<{ view: ApplicationView & { viewWorkspaceId: number }; workspace: Workspace } | Response> {
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  const db = getDb();
  const { slug, preview: key, share } = viewQuery(request);
  const application = viewedApplication(db, slug);
  const preview = application && previewOf(application, key);
  if (!application || preview === undefined) return notFound();
  const workspace = await writableWorkspace();
  const view = resolveApplicationView(db, application, workspace, share, preview);
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
    if (error instanceof WorkspaceLimitError) return Response.json({ errors: { body: [error.message] } }, { status: 400 });
    throw error;
  }
}

export function stringField(body: Record<string, unknown>, name: string, max = 200): string {
  const value = body[name];
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Whether a request that changes something came from the Frontend
 * Registry's own pages: the browser says so in `Sec-Fetch-Site`, or, without
 * it, in an `Origin` naming the host the request was made to. A request
 * from another site is refused, whatever cookies it carries.
 */
export function fromOwnOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
