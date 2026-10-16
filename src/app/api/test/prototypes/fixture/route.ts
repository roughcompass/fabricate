import { createFixturePrototype, e2eRoutesEnabled } from "@/lib/prototypes/testing";

// Browser-test support: creates a prototype from supplied code in the
// visitor's workspace. Answers 404 unless FABRICATE_E2E=1 outside production.
export async function POST(request: Request) {
  if (!e2eRoutesEnabled()) return new Response(null, { status: 404 });
  return Response.json(await createFixturePrototype(await request.json()), { status: 201 });
}
