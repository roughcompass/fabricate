import { and, eq } from "drizzle-orm";
import { endpointContext, notFound } from "@/lib/prototypes/api";
import { lessonChecks } from "@/lib/prototypes/db/schema";

/** A lesson check's status, which the Lessons page polls while it runs. */
export async function GET(_request: Request, { params }: { params: Promise<{ checkId: string }> }) {
  const { checkId } = await params;
  const context = await endpointContext(checkId, "lck");
  if (context instanceof Response) return context;
  const [check] = await context.db
    .select({ status: lessonChecks.status })
    .from(lessonChecks)
    .where(and(eq(lessonChecks.workspaceId, context.workspace.id), eq(lessonChecks.id, checkId)));
  return check ? Response.json({ version: check.status }) : notFound();
}
