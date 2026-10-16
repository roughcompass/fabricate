import { z } from "zod";
import { e2eRoutesEnabled, selectRunner, withExamples, withPrototypesEnabled, withoutModelCredentials } from "@/lib/prototypes/testing";

const schema = z.object({ credentials: z.literal("none").optional(), runner: z.enum(["workflow", "inline"]).optional(), examples: z.boolean().optional(), enabled: z.boolean().optional() });

// Browser-test support: runs the server with no model credential, with
// another runner, seeding new workspaces' examples, or with Prototypes off,
// until the next reset. Answers 404 unless FABRICATE_E2E=1 outside production.
export async function POST(request: Request) {
  if (!e2eRoutesEnabled()) return new Response(null, { status: 404 });
  const settings = schema.parse(await request.json());
  if (settings.credentials === "none") withoutModelCredentials();
  if (settings.runner) selectRunner(settings.runner);
  if (settings.examples !== undefined) withExamples(settings.examples);
  if (settings.enabled !== undefined) withPrototypesEnabled(settings.enabled);
  return Response.json(settings);
}
