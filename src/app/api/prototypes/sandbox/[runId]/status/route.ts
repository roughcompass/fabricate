import { and, eq } from "drizzle-orm";
import { endpointContext, notFound } from "@/lib/prototypes/api";
import { sandboxRuns } from "@/lib/prototypes/db/schema";

/** A Sandbox run's status and stage, which the prototype page polls while it starts. */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const context = await endpointContext(runId, "sbx");
  if (context instanceof Response) return context;
  const [run] = await context.db
    .select({ status: sandboxRuns.status, stage: sandboxRuns.stage })
    .from(sandboxRuns)
    .where(and(eq(sandboxRuns.workspaceId, context.workspace.id), eq(sandboxRuns.id, runId)));
  return run ? Response.json({ version: `${run.status}|${run.stage}` }) : notFound();
}
