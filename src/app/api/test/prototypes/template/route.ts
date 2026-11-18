import { z } from "zod";
import { e2eRoutesEnabled, recordTemplateStandards, staleTemplate } from "@/lib/prototypes/testing";

const schema = z.object({
  slug: z.string().max(200),
  code: z.string().max(100_000).optional(),
  styles: z.string().max(20_000).optional(),
  standards: z.object({ status: z.literal("evaluated"), assessmentId: z.string().max(40), evaluationId: z.string().max(40) }).optional(),
});

// Browser-test support: makes a template look accepted before a Salt upgrade,
// optionally with other code and CSS module, or, given standards, records another Run and
// Evaluation for it. Answers 404 unless FABRICATE_E2E=1 outside production.
export async function POST(request: Request) {
  if (!e2eRoutesEnabled()) return new Response(null, { status: 404 });
  const { slug, code, styles, standards } = schema.parse(await request.json());
  const stale = standards ? await recordTemplateStandards(slug, standards) : await staleTemplate(slug, code, styles);
  return stale ? Response.json(stale) : new Response(null, { status: 404 });
}
