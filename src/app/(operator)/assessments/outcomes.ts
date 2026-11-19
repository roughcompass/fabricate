import type { Outcome } from "@/components/ui/outcome-toast";

/**
 * Messages for the outcome codes Initiative actions redirect with. Text is
 * built from the record, never from the URL; an unknown code shows nothing.
 */

export function assessmentListOutcome(code: string | undefined): Outcome | undefined {
  return code === "deleted" ? { id: "deleted", tone: "success", title: "The Assessment was deleted." } : undefined;
}

export function assessmentOutcome(code: string | undefined, assessment: { name: string; publicId: string }): Outcome | undefined {
  const id = `${code}:${assessment.publicId}`;
  switch (code) {
    case "created":
      return { id, tone: "success", title: `${assessment.name} was created.` };
    case "updated":
      return { id, tone: "success", title: `${assessment.name} was updated.`, description: "Existing Runs and Evaluations keep the scope and Releases they started with." };
    case "retained":
      return { id, tone: "warning", title: `${assessment.name} was not deleted.`, description: "It has Runs, so it is kept to keep their history reviewable." };
    default:
      return undefined;
  }
}
