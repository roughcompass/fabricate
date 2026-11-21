import { getDb } from "@/lib/db/client";
import { NO_STORE, jsonObject, mockChange, mockSetOf, ruleInputFrom, shownRule } from "@/lib/mocks/api";
import { recaptureApplication } from "@/lib/mocks/recapture";
import { createRule, editRule } from "@/lib/mocks/records";

/*
 * A mock set's rules (add-mock-sets, design decision 15, task 4.2): what
 * Data's Create rule posts.
 *
 * - POST `{ method, pattern, origin?, query: { mode, params, ignored },
 *   body: { mode, text? }, responses: [{ status, headers, contentType,
 *   body: { text } | { base64 } | null, latencyMs }], enabled? }`: adds a
 *   rule at the end of the set; 201, with the set's new revision, so the
 *   caller arms it. Without a response, the rule is added turned off, marked
 *   Needs a response.
 * - PATCH `?rule=<id>`, `{ …, lockVersion }`: edits a rule; 409, with the
 *   rule as it stands, when someone else changed it first.
 *
 * Bodies of up to 5 MB; the request up to 8 MB. Not found as the sets'
 * endpoint is, and for a set of another application; 403 for a change from
 * another origin.
 */

export async function POST(request: Request, ctx: RouteContext<"/api/applications/[slug]/mock-sets/[set]/rules">) {
  const { slug, set: setPublicId } = await ctx.params;
  const found = mockSetOf(slug, setPublicId);
  if (found instanceof Response) return found;
  const body = await jsonObject(request);
  if (body instanceof Response) return body;
  return mockChange(request, (workspace) => {
    const { rule, set } = createRule(getDb(), found.application.id, found.set.publicId, ruleInputFrom(body), workspace.displayName);
    // A change to the default set captures its builds again (add-mock-sets, design decision 11).
    recaptureApplication(getDb(), found.application.id);
    return Response.json({ rule: shownRule(rule), set: { publicId: set.publicId, revision: set.revision, ruleCount: set.ruleCount } }, { status: 201, headers: NO_STORE });
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/applications/[slug]/mock-sets/[set]/rules">) {
  const { slug, set: setPublicId } = await ctx.params;
  const found = mockSetOf(slug, setPublicId);
  if (found instanceof Response) return found;
  const body = await jsonObject(request);
  if (body instanceof Response) return body;
  const ruleId = new URL(request.url).searchParams.get("rule") ?? "";
  return mockChange(request, (workspace) => {
    const { rule, set } = editRule(getDb(), found.application.id, found.set.publicId, ruleId, Number(body.lockVersion), ruleInputFrom(body), workspace.displayName);
    recaptureApplication(getDb(), found.application.id);
    return Response.json({ rule: shownRule(rule), set: { publicId: set.publicId, revision: set.revision, ruleCount: set.ruleCount } }, { headers: NO_STORE });
  });
}
