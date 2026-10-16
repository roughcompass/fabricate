import { matchingTemplates } from "@/lib/demo/gallery-templates";
import { prototypesUnavailable } from "@/lib/prototypes/guard";
import { INTENT_LENGTH } from "@/lib/prototypes/limits";

/** The usable templates matching an intent, for New prototype to offer as it changes (generation spec, "New prototype shows matching templates"). */
export async function GET(request: Request) {
  const unavailable = prototypesUnavailable();
  if (unavailable) return unavailable;
  const intent = (new URL(request.url).searchParams.get("intent") ?? "").slice(0, INTENT_LENGTH.max);
  return Response.json(await matchingTemplates(intent), { headers: { "Cache-Control": "no-store" } });
}
