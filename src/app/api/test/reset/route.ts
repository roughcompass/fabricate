import { e2eRoutesEnabled, resetE2eData } from "@/lib/testing/e2e";

// Browser-test support: resets all data. Answers 404 unless FRONTEND_REGISTRY_E2E=1
// outside production.
export function POST() {
  if (!e2eRoutesEnabled()) return new Response(null, { status: 404 });
  resetE2eData();
  return Response.json({ reset: true });
}
