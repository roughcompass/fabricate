import type { Outcome } from "@/components/ui/outcome-toast";

/**
 * Messages for the outcome codes Assessment actions redirect with. Text is
 * built from the record, never from the URL; an unknown code shows nothing.
 */
export function assessmentOutcome(code: string | undefined, assessment: { publicId: string }, name: string): Outcome | undefined {
  const id = `${code}:${assessment.publicId}`;
  switch (code) {
    case "started":
      return { id, tone: "success", title: `${name} was started.` };
    case "already-started":
      return { id, tone: "info", title: `${name} was already started.`, description: "No duplicate work was created." };
    case "cancel-requested":
      return { id, tone: "success", title: "Cancellation was requested.", description: "Repositories that have not finished stop at their next check; completed Profiles are kept." };
    case "already-finished":
      return { id, tone: "info", title: `${name} had already finished.`, description: "There was nothing to cancel." };
    default:
      return undefined;
  }
}
