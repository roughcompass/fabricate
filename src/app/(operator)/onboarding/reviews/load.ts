import { cache } from "react";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { placementReview } from "@/lib/onboarding/reviews";

export const reviewHref = (placement: string) => `/onboarding/reviews/${placement}`;
export const reviewCrumbs = [{ href: "/onboarding/reviews", label: "Reviews" }];

/** The placement review a page is about, read once per request. */
export const loadReview = cache((publicId: string) => {
  if (!isPublicId(publicId, "plc")) return null;
  const db = getDb();
  const review = placementReview(db, publicId);
  return review ? { db, review } : null;
});
