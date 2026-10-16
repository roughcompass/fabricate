import type { Outcome } from "@/components/ui/outcome-toast";
import type { Provenance } from "@/lib/prototypes/types";

/** Messages for the outcome codes a prototype's page is opened with. Text comes from the records, never from the URL. */
export function prototypeOutcome(code: string | undefined, prototype: { id: string; name: string }, origin?: Pick<Provenance, "forkedFrom" | "startedFromTemplate"> | null): Outcome | undefined {
  const forkedFrom = origin?.forkedFrom;
  const id = `${code}:${prototype.id}`;
  switch (code) {
    case "refining":
      return { id, tone: "info", title: "The refinement started.", description: "The new version appears in the thread when it is ready; you can leave this page meanwhile." };
    case "renamed":
      return { id, tone: "success", title: `Renamed to ${prototype.name}.` };
    case "forked":
      return forkedFrom ? { id, tone: "success", title: `Forked from ${forkedFrom.prototypeName} v${forkedFrom.number}.`, description: "The original is unchanged." } : undefined;
    case "accepted":
      return { id, tone: "success", title: "Accepted as a template.", description: "It is in the Salt Patterns gallery, marked From Prototypes." };
    case "withdrawn":
      return { id, tone: "success", title: "The template was withdrawn.", description: "It no longer appears in the gallery." };
    case "from-template":
      return origin?.startedFromTemplate ? { id, tone: "success", title: `Started from the template ${origin.startedFromTemplate.title} v${origin.startedFromTemplate.templateVersion}.`, description: "This prototype is yours; the template is unchanged." } : undefined;
    case "share-revoked":
      return { id, tone: "success", title: "The share link was revoked.", description: "Anyone who opens it now sees a page that isn't found." };
    case "fork-limit":
      return { id, tone: "error", title: "This workspace holds as many prototypes as it can.", description: "Delete one to fork another." };
    default:
      return undefined;
  }
}
