import type { Outcome } from "@/components/ui/outcome-toast";
import type { Microfrontend } from "@/lib/onboarding/microfrontends";

/** Messages for the codes MFE actions redirect with, built from the record so a crafted link can't inject text. */
export function mfeOutcome(code: string | undefined, mfe: Microfrontend): Outcome | undefined {
  const id = `${code}:${mfe.publicId}`;
  switch (code) {
    case "created":
      return { id, tone: "success", title: `${mfe.name} is a Draft MFE.`, description: "Fill in each step, then submit it." };
    case "draft-started":
      return { id, tone: "success", title: "A new Draft is open.", description: "The submitted revision is unchanged until this one is submitted." };
    case "saved":
      return { id, tone: "success", title: "The Draft is saved." };
    case "submitted":
      return { id, tone: "success", title: `${mfe.name}'s revision is submitted.` };
    case "retired":
      return { id, tone: "success", title: `${mfe.name} is retired.` };
    case "refresh":
      return { id, tone: "info", title: "A read of CDaaS and Studio is queued.", description: "Its results appear here when the worker finishes." };
    case "reference":
      return { id, tone: "success", title: "The mapping is saved." };
    case "reference-removed":
      return { id, tone: "success", title: "The mapping is removed." };
    default:
      return undefined;
  }
}
