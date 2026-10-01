import { cookies } from "next/headers";
import { getDb } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { errorsFrom } from "@/lib/web/form-data";
import { type DemoView, resolveView } from "./access";
import { demoUnavailable } from "./guard";
import { currentWorkspace, writableWorkspace } from "./request";
import { shareCookieName } from "./runtime-view";
import type { Workspace } from "./workspaces";

/**
 * Shared plumbing for the demo's JSON route handlers: the demo switch, view
 * authorization (the visitor's workspace, or a remembered share link), and
 * bounded JSON bodies.
 */

const BODY_LIMIT = 16 * 1024;

export const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

export function invalid(error: ValidationError): Response {
  return Response.json({ errors: errorsFrom(error) }, { status: 400 });
}

/** The view a request may read, or a response that refuses it. */
export async function readableView(applicationId: string): Promise<{ view: DemoView; workspace: Workspace | null } | Response> {
  const unavailable = demoUnavailable();
  if (unavailable) return unavailable;
  const workspace = await currentWorkspace();
  const token = (await cookies()).get(shareCookieName(applicationId))?.value ?? null;
  const db = getDb();
  const view = (token ? resolveView(db, applicationId, workspace, token) : null) ?? resolveView(db, applicationId, workspace, null);
  return view ? { view, workspace } : notFound();
}

/** The view a request may write to, creating the visitor's workspace on first use. */
export async function writableView(applicationId: string): Promise<{ view: DemoView & { viewWorkspaceId: number }; workspace: Workspace } | Response> {
  const unavailable = demoUnavailable();
  if (unavailable) return unavailable;
  const workspace = await writableWorkspace();
  const token = (await cookies()).get(shareCookieName(applicationId))?.value ?? null;
  const db = getDb();
  const view = (token ? resolveView(db, applicationId, workspace, token) : null) ?? resolveView(db, applicationId, workspace, null);
  if (!view || view.viewWorkspaceId === null) return notFound();
  return { view: view as DemoView & { viewWorkspaceId: number }, workspace };
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

/** Runs a write, turning validation problems into a 400 response. */
export function attempt(work: () => Response): Response {
  try {
    return work();
  } catch (error) {
    if (error instanceof ValidationError) return invalid(error);
    throw error;
  }
}

export function stringField(body: Record<string, unknown>, name: string, max = 200): string {
  const value = body[name];
  return typeof value === "string" ? value.slice(0, max) : "";
}
