import type { Outcome } from "@/components/ui/outcome-toast";
import { PROTOTYPE_LIMIT } from "@/lib/prototypes/limits";

/** Messages for the outcome codes the variants page is opened with. Text comes from the records, never from the URL. */
export function variantsOutcome(code: string | undefined, kept: { id: string; name: string } | undefined, reason: string | undefined): Outcome | undefined {
  switch (code) {
    case "kept":
      return kept && { id: `kept:${kept.id}`, tone: "success", title: `Kept as ${kept.name}.`, description: "It is in All Prototypes at version 1." };
    case "discarded":
      return { id: "discarded", tone: "success", title: "The variant was discarded.", description: "Any reason you gave is kept as feedback." };
    case "refused":
      return reason === "reason"
        ? { id: "refused:reason", tone: "error", title: "The reason is too long.", description: "Keep it to 2,000 characters." }
        : { id: "refused:limit", tone: "warning", title: "That variant can't be kept.", description: `It may already be kept or discarded, or the workspace already holds ${PROTOTYPE_LIMIT} prototypes.` };
    case "delete-running":
      return { id: "delete-running", tone: "warning", title: "This generation is still running.", description: "Delete it once its variants finish." };
    case "limit":
      return { id: "limit", tone: "warning", title: "Today's generations are used up.", description: "A retry counts as a generation; more are available from midnight UTC." };
    default:
      return undefined;
  }
}
