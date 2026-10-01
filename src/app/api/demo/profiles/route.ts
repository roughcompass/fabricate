import { getDb } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { attempt, invalid, jsonBody } from "@/lib/demo/api";
import { demoUnavailable } from "@/lib/demo/guard";
import { createProfile, listProfiles } from "@/lib/demo/profiles";
import { currentWorkspace, writableWorkspace } from "@/lib/demo/request";

/** The visitor's own session profiles (template-demo/toolbar spec); none before their workspace's first write. */
export async function GET() {
  const unavailable = demoUnavailable();
  if (unavailable) return unavailable;
  const workspace = await currentWorkspace();
  return Response.json({ profiles: workspace ? listProfiles(getDb(), workspace.id) : [] });
}

/** Creates a profile in the visitor's workspace, creating the workspace on first use. */
export async function POST(request: Request) {
  const unavailable = demoUnavailable();
  if (unavailable) return unavailable;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const workspace = await writableWorkspace().catch((error: unknown) => (error instanceof ValidationError ? invalid(error) : Promise.reject(error)));
  if (workspace instanceof Response) return workspace;
  return attempt(() => {
    const db = getDb();
    const profile = createProfile(db, workspace.id, body);
    return Response.json({ profile, profiles: listProfiles(db, workspace.id) }, { status: 201 });
  });
}
