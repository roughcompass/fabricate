import { findAssessment } from "@/lib/assessments/assessment-records";
import { assessmentStatus } from "@/lib/assessments/status";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";

// Progress for pages that poll while an Assessment or its Evaluations are running.
export async function GET(_request: Request, { params }: { params: Promise<{ assessmentId: string }> }) {
  const { assessmentId } = await params;
  const db = getDb();
  const assessment = isPublicId(assessmentId, "asm") ? findAssessment(db, assessmentId) : undefined;
  if (!assessment) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(assessmentStatus(db, assessment), { headers: { "Cache-Control": "no-store" } });
}
