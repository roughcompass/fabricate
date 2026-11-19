import { applicationsUnavailable } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { findPreparation, findPreview, settleAbandonedPreparations } from "@/lib/previews/records";

/*
 * Whether onboarding's eligibility check has been decided (applications/
 * onboarding spec, "Checking takes time"): GET with `preparation`, a
 * preparation's ID, and in preview mode also `preview`, the build of another
 * ref. Answers a version that changes when the decision is made or the build
 * moves on, which the page polls while it shows "Checking…" or "Building".
 */
export function GET(request: Request): Response {
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  const id = new URL(request.url).searchParams.get("preparation") ?? "";
  if (!isPublicId(id, "ppr")) return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  settleAbandonedPreparations(getDb());
  const preparation = findPreparation(getDb(), id);
  if (!preparation) return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const previewId = new URL(request.url).searchParams.get("preview");
  const preview = previewId && isPublicId(previewId, "pvw") ? findPreview(getDb(), previewId) : undefined;
  const build = preview ? `:${preview.attempt}:${preview.attemptState}:${preview.artifact ?? ""}` : "";
  return Response.json({ version: `${preparation.state}:${preparation.requestedAt.getTime()}${build}` }, { headers: { "Cache-Control": "no-store" } });
}
