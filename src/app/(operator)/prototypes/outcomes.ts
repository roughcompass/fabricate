import type { Outcome } from "@/components/ui/outcome-toast";

/** Messages for the outcome codes the Prototypes list is opened with. Text comes from the records, never from the URL. */
export function prototypesListOutcome(code: string | undefined): Outcome | undefined {
  switch (code) {
    case "deleted":
      return { id: "deleted", tone: "success", title: "The prototype was deleted.", description: "Lessons learned from it remain, and so does any template accepted from it." };
    case "generation-deleted":
      return { id: "generation-deleted", tone: "success", title: "The generation was deleted.", description: "Its unkept variants are gone. Prototypes kept from it, and lessons it taught, remain." };
    case "reset":
      return { id: "reset", tone: "success", title: "Prototypes was reset.", description: "The seeded examples are back. Your share links no longer open, and templates you accepted stay in the gallery." };
    default:
      return undefined;
  }
}
