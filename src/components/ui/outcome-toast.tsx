import { FlashToast, type Outcome } from "./flash-toast";

export type { Outcome } from "./flash-toast";

/** The URL parameters an outcome travels in; they are removed once it shows. */
const OUTCOME_PARAMS = ["notice", "source", "count", "failed"] as const;

/**
 * Shows the outcome of the action that redirected here. Server Actions redirect
 * with an outcome code; each area maps its codes to messages built from its own
 * records, so a crafted link can never inject text. Renders nothing for an
 * unknown code.
 */
export function OutcomeToast({ outcome, strip = OUTCOME_PARAMS }: { outcome: Outcome | undefined; strip?: readonly string[] }) {
  return outcome ? <FlashToast outcome={outcome} strip={strip} /> : null;
}
