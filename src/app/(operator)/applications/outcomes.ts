import type { Outcome } from "@/components/ui/outcome-toast";
import type { Application } from "@/lib/applications/records";

/**
 * Messages for the outcome codes application actions redirect with. The URL
 * carries only a code; the text is built from the record, so a crafted link
 * cannot inject text. An unknown code shows nothing.
 */
export function applicationOutcome(code: string | undefined, application?: Application): Outcome | undefined {
  if (!code) return undefined;
  if (code === "deleted") return { id: "deleted", tone: "success", title: "The application was deleted.", description: "Its builds stay with its Repository's previews until they're pruned." };
  if (!application) return undefined;
  const id = `${code}:${application.publicId}:${application.latest.requestedAt.getTime()}`;
  switch (code) {
    case "created":
      return { id, tone: "success", title: `${application.name} was created.`, description: "Its first build is queued. Its card shows the screenshot when the build is ready." };
    case "rebuilt":
      return { id, tone: "success", title: `A build of ${application.name} is queued.`, description: application.current ? "The current build stays in use until the new one is ready." : undefined };
    case "building":
      return { id, tone: "info", title: `${application.name} is already building.`, description: "It can be rebuilt once this build finishes." };
    case "unreachable":
      return { id, tone: "error", title: `${application.name}'s branch couldn't be read.`, description: "Nothing was queued. Check that the remote is reachable and the branch exists, then try again." };
    case "updated":
      return { id, tone: "success", title: `${application.name} was updated.` };
    case "branch":
      return { id, tone: "success", title: `${application.name} now tracks ${application.trackedBranch}.`, description: "A build of its current commit is queued; the current build stays in use until it's ready." };
    default:
      return undefined;
  }
}
