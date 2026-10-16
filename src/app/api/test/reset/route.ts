import { resetPrototypesE2eData } from "@/lib/prototypes/testing";
import { e2eRoutesEnabled, resetE2eData } from "@/lib/testing/e2e";

// Browser-test support: resets all data, the Prototypes store included.
// Answers 404 unless FABRICATE_E2E=1 outside production.
export async function POST() {
  if (!e2eRoutesEnabled()) return new Response(null, { status: 404 });
  resetE2eData();
  await resetPrototypesE2eData();
  return Response.json({ reset: true });
}
