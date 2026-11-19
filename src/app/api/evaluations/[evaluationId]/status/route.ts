import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { findEvaluation } from "@/lib/evaluations/evaluation-records";
import { evaluationStatus } from "@/lib/runs/status";

// Progress for pages that poll while an Evaluation is running.
export async function GET(_request: Request, { params }: { params: Promise<{ evaluationId: string }> }) {
  const { evaluationId } = await params;
  const db = getDb();
  const evaluation = isPublicId(evaluationId, "evl") ? findEvaluation(db, evaluationId) : undefined;
  if (!evaluation) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(evaluationStatus(db, evaluation), { headers: { "Cache-Control": "no-store" } });
}
