import { getDb } from "@/lib/db/client";
import { attempt, jsonBody, notFound } from "@/lib/demo/api";
import { demoUnavailable } from "@/lib/demo/guard";
import { deleteProfile, isBuiltInProfileId, listProfiles, updateProfile } from "@/lib/demo/profiles";
import { currentWorkspace } from "@/lib/demo/request";

type Params = { params: Promise<{ profileId: string }> };

const builtIn = () => Response.json({ error: "Built-in profiles can't be changed" }, { status: 403 });

/** Changes one of the visitor's profiles; another workspace's profile is not found. */
export async function PATCH(request: Request, { params }: Params) {
  const unavailable = demoUnavailable();
  if (unavailable) return unavailable;
  const { profileId } = await params;
  if (isBuiltInProfileId(profileId)) return builtIn();
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const workspace = await currentWorkspace();
  if (!workspace) return notFound();
  return attempt(() => {
    const db = getDb();
    const profile = updateProfile(db, workspace.id, profileId, body);
    return profile ? Response.json({ profile, profiles: listProfiles(db, workspace.id) }) : notFound();
  });
}

/** Deletes one of the visitor's profiles. */
export async function DELETE(_request: Request, { params }: Params) {
  const unavailable = demoUnavailable();
  if (unavailable) return unavailable;
  const { profileId } = await params;
  if (isBuiltInProfileId(profileId)) return builtIn();
  const workspace = await currentWorkspace();
  if (!workspace) return notFound();
  const db = getDb();
  return deleteProfile(db, workspace.id, profileId) ? Response.json({ profiles: listProfiles(db, workspace.id) }) : notFound();
}
