import type { Outcome } from "@/components/ui/outcome-toast";
import type { RepositorySource } from "@/lib/catalog/source-records";

/** Messages for the codes claim actions redirect with, built from the record so a crafted link can't inject text. */
export function claimOutcome(code: string | undefined, source: RepositorySource): Outcome | undefined {
  const id = `${code}:${source.publicId}`;
  switch (code) {
    case "registered":
      return { id, tone: "success", title: `${source.name} was added to the catalog.` };
    case "claimed":
      return { id, tone: "success", title: `${source.name} is claimed.` };
    case "claimed-started":
      return { id, tone: "success", title: `${source.name} is claimed.`, description: "A Run of its default branch has started." };
    case "owner-confirmed":
      return { id, tone: "success", title: "The portal's owner is recorded." };
    case "corrected":
      return { id, tone: "success", title: "Your corrections are saved." };
    case "seal-corrected":
      return { id, tone: "success", title: "The Repository now belongs to another application.", description: "Answer what isn't known about it." };
    default:
      return undefined;
  }
}
