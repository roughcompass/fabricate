import type { Outcome } from "@/components/ui/outcome-toast";
import type { Portal } from "@/lib/onboarding/portals";

/** Messages for the codes Portal actions redirect with, built from the record so a crafted link can't inject text. */
export function portalOutcome(code: string | undefined, portal: Portal): Outcome | undefined {
  const id = `${code}:${portal.publicId}`;
  switch (code) {
    case "created":
      return { id, tone: "success", title: `${portal.label} is a Draft Portal.`, description: "Fill in each step, then submit it for activation." };
    case "adopted":
      return { id, tone: "success", title: `${portal.label} is being onboarded.`, description: "It was first named in an ownership claim; its claims stay with it." };
    case "draft-started":
      return { id, tone: "success", title: "A new Draft is open.", description: "The active revision is unchanged until this one is activated." };
    case "saved":
      return { id, tone: "success", title: "The Draft is saved." };
    case "submitted":
      return { id, tone: "success", title: `${portal.label}'s revision is submitted.` };
    case "activated":
      return { id, tone: "success", title: `${portal.label} is active.` };
    case "default":
      return { id, tone: "success", title: "The default route is saved." };
    case "retired":
      return { id, tone: "success", title: `${portal.label} is retired.` };
    case "refresh":
      return { id, tone: "info", title: "A read of Studio is queued.", description: "Its results appear here when the worker finishes." };
    case "reference":
      return { id, tone: "success", title: "The mapping is saved." };
    case "reference-removed":
      return { id, tone: "success", title: "The mapping is removed." };
    default:
      return undefined;
  }
}
