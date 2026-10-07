import { formatDate } from "@/components/ui/time";
import type { PlacementCandidate } from "@/lib/onboarding/applications";

/** Where a placement candidate comes from, as a sentence: who claimed it, from where, and when. */
export function claimText(candidate: PlacementCandidate): string {
  const { claim } = candidate;
  const by = claim.source === "de_console" ? "Listed by the DE Console" : claim.source === "bulk_import" ? `Imported by ${claim.providedBy}, unverified` : `Claimed by ${claim.providedBy}, unverified`;
  return `${by}, ${formatDate(claim.recordedAt)}`;
}
