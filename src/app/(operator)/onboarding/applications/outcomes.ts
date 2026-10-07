import type { Outcome } from "@/components/ui/outcome-toast";
import { applicationName } from "@/lib/onboarding/applications";
import type { Application } from "@/lib/ownership/records";

/** Messages for the codes Application actions redirect with, built from the record so a crafted link can't inject text. */
export function applicationOutcome(code: string | undefined, application: Application): Outcome | undefined {
  const id = `${code}:${application.publicId}`;
  const name = applicationName(application);
  switch (code) {
    case "created":
      return { id, tone: "success", title: `${name} is a Draft Web Application.`, description: "Fill in each step, then submit it. Each placement is then reviewed by its Portal." };
    case "draft-started":
      return { id, tone: "success", title: "A new Draft is open.", description: "The submitted revision and its placement reviews are unchanged until this one is submitted." };
    case "saved":
      return { id, tone: "success", title: "The Draft is saved." };
    case "confirmed":
      return { id, tone: "success", title: "The rendering mode is confirmed.", description: "Changing the launch values clears it." };
    case "submitted":
      return { id, tone: "success", title: `${name}'s revision is submitted.`, description: "Each placement waits for its Portal's review." };
    case "mfe-submitted":
      return { id, tone: "success", title: "The MFE's revision is submitted.", description: `It's a shared asset now. Add it as a child of ${name} below, or launch it, once CDaaS confirms its view.` };
    case "retired":
      return { id, tone: "success", title: `${name} is retired.` };
    case "refresh":
      return { id, tone: "info", title: "A read of Studio and CDaaS is queued.", description: "Its results appear here when the worker finishes." };
    case "reference":
      return { id, tone: "success", title: "The mapping is saved." };
    case "reference-removed":
      return { id, tone: "success", title: "The mapping is removed." };
    default:
      return undefined;
  }
}
