import { and, eq } from "drizzle-orm";
import { endpointContext, notFound } from "@/lib/prototypes/api";
import { pairwiseReviews } from "@/lib/prototypes/db/schema";

/** A pairwise review's status, which the compare page polls while it runs. */
export async function GET(_request: Request, { params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  const context = await endpointContext(reviewId, "pwr");
  if (context instanceof Response) return context;
  const [review] = await context.db
    .select({ status: pairwiseReviews.status })
    .from(pairwiseReviews)
    .where(and(eq(pairwiseReviews.workspaceId, context.workspace.id), eq(pairwiseReviews.id, reviewId)));
  return review ? Response.json({ version: review.status }) : notFound();
}
