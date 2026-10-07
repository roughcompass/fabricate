import type { Outcome } from "@/components/ui/outcome-toast";
import { type PlacementReview, reviewTitle } from "@/lib/onboarding/reviews";

/** Messages for the codes review actions redirect with, built from the record so a crafted link can't inject text. */
export function reviewOutcome(code: string | undefined, review: PlacementReview): Outcome | undefined {
  const id = `${code}:${review.placement.publicId}:${review.sequence}`;
  const title = reviewTitle(review);
  switch (code) {
    case "approve":
      return { id, tone: "success", title: `${title} is approved.`, description: `Recorded in onboarding, unverified. Nothing changed in Studio, CDaaS, or ServiceNow.` };
    case "reject":
      return { id, tone: "success", title: `${title} is rejected.`, description: "The reason is recorded with the decision." };
    case "withdraw":
      return { id, tone: "success", title: `${title} is withdrawn.` };
    case "retire":
      return { id, tone: "success", title: `${title} is retired.`, description: "Its route is no longer served in onboarding's record." };
    case "refresh":
      return { id, tone: "info", title: "A read of Studio is queued.", description: "Its results appear here when the worker finishes." };
    case "reference":
      return { id, tone: "success", title: "The mapping is saved." };
    case "reference-removed":
      return { id, tone: "success", title: "The mapping is removed." };
    default:
      return undefined;
  }
}
