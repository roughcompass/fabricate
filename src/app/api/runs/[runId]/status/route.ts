import { findRun } from "@/lib/runs/run-records";
import { runStatus } from "@/lib/runs/status";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";

// Progress for pages that poll while a Run or its Evaluations are running.
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const db = getDb();
  const run = isPublicId(runId, "asm") ? findRun(db, runId) : undefined;
  if (!run) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(runStatus(db, run), { headers: { "Cache-Control": "no-store" } });
}
