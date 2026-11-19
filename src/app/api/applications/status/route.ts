import { applicationsUnavailable } from "@/lib/applications/availability";
import { applicationsByPublicId, statusSnapshot } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";

/*
 * The status of the applications a page shows (applications/catalog spec,
 * "Applications update while builds run"): GET with `ids`, a comma-separated
 * list of at most a page's worth of application IDs. It answers each one's
 * status and image, and a version the page compares with its own to know when
 * to refresh. Unknown IDs are left out; not found while previews are off.
 */

/** More than the Applications page's 24 cards; extra IDs are ignored. */
const MAX_IDS = 50;

export function GET(request: Request): Response {
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .filter((id) => isPublicId(id, "app"))
    .slice(0, MAX_IDS);
  const shown = applicationsByPublicId(getDb(), ids).sort((a, b) => ids.indexOf(a.publicId) - ids.indexOf(b.publicId));
  return Response.json(statusSnapshot(shown), { headers: { "Cache-Control": "no-store" } });
}
