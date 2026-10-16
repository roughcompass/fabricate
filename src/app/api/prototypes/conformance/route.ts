import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { conformanceOf } from "@/lib/prototypes/conformance";
import { prototypesUnavailable, templatesAvailable } from "@/lib/prototypes/guard";

/**
 * Where a version's check at acceptance stands, for the confirmation step to
 * poll (template-conformance spec): `run` is the Salt Patterns Run started
 * when the visitor continued, or absent when none was started because no
 * Release is selected.
 */
export function GET(request: Request) {
  const unavailable = prototypesUnavailable();
  if (unavailable) return unavailable;
  if (!templatesAvailable()) return new Response(null, { status: 404 });
  const query = new URL(request.url).searchParams;
  const version = query.get("version");
  const run = query.get("run");
  if (!isPublicId(version, "ver") || (run !== null && !isPublicId(run, "asm"))) return new Response(null, { status: 404 });
  return Response.json(conformanceOf(getDb(), run, version), { headers: { "Cache-Control": "no-store" } });
}
