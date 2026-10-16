import type { Outcome } from "@/components/ui/outcome-toast";

/** Messages for the outcome codes persona actions redirect with. Text comes from the records, never from the URL. */
export function personaOutcome(code: string | undefined, persona: { id: string; name: string } | undefined): Outcome | undefined {
  switch (code) {
    case "created":
      return persona && { id: `created:${persona.id}`, tone: "success", title: `${persona.name} was added.`, description: "Choose them in New prototype." };
    case "updated":
      return persona && { id: `updated:${persona.id}`, tone: "success", title: `${persona.name} was updated.`, description: "Versions generated earlier keep the details they were generated with." };
    case "deleted":
      return { id: "deleted", tone: "success", title: "The persona was deleted.", description: "Prototypes generated for them still name them in their history." };
    default:
      return undefined;
  }
}
