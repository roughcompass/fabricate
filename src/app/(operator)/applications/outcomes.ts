import type { Outcome } from "@/components/ui/outcome-toast";
import type { Application } from "@/lib/applications/records";
import type { SavedPreview } from "@/lib/applications/saved-previews";

/**
 * Messages for the outcome codes application actions redirect with. The URL
 * carries only a code; the text is built from the record, so a crafted link
 * cannot inject text. An unknown code shows nothing.
 */
export function applicationOutcome(code: string | undefined, application?: Application, saved?: SavedPreview): Outcome | undefined {
  if (!code) return undefined;
  if (code === "deleted") return { id: "deleted", tone: "success", title: "The application was deleted.", description: "Its builds stay with its Repository's previews until they're pruned." };
  if (!application) return undefined;
  if (code.startsWith("preview-")) return savedPreviewOutcome(code, application, saved);
  const id = `${code}:${application.publicId}:${application.latest.requestedAt.getTime()}`;
  switch (code) {
    case "created":
      return { id, tone: "success", title: `${application.name} was created.`, description: "Its first build is queued. Its card shows the screenshot when the build is ready." };
    case "created-with-mocks":
      return { id, tone: "success", title: `${application.name} was created, with a mock set.`, description: "Its first build is queued, and its screenshot applies the mock set, its default." };
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
    // Mock sets (add-mock-sets): the section's row actions, and cancelling an upload.
    case "mock-default-set":
      return { id: `${code}:${application.publicId}`, tone: "success", title: "The default mock set was changed.", description: "Views no one chose a set for apply it, and the current build is captured again with it." };
    case "mock-default-cleared":
      return { id: `${code}:${application.publicId}`, tone: "success", title: `${application.name} has no default mock set.`, description: "Views no one chose a set for use the application's own network." };
    case "mock-set-deleted":
      return { id: `${code}:${application.publicId}`, tone: "success", title: "The mock set was deleted.", description: "It's gone for everyone who opens the application. Views that chose it apply their default set again." };
    case "upload-cancelled":
      return { id: `${code}:${application.publicId}`, tone: "info", title: "The upload was cancelled.", description: "Nothing of the file was kept." };
    default:
      return undefined;
  }
}

/** Messages for a saved preview's actions, built from the preview the address names by its key; a removed one names no ref. */
function savedPreviewOutcome(code: string, application: Application, saved: SavedPreview | undefined): Outcome | undefined {
  if (code === "preview-removed") return { id: `${code}:${application.publicId}`, tone: "success", title: "The saved preview was removed.", description: "Its builds are pruned like any other preview once nothing else uses them. Comments placed on it stay." };
  if (!saved) return undefined;
  const id = `${code}:${saved.publicId}:${saved.latest.requestedAt.getTime()}`;
  switch (code) {
    case "preview-rebuilt":
      return { id, tone: "success", title: `A build of ${saved.label} is queued.`, description: saved.current ? "Its current build stays in use until the new one is ready." : undefined };
    case "preview-building":
      return { id, tone: "info", title: `${saved.label} is already building.`, description: "It can be rebuilt once this build finishes." };
    case "preview-mock-set":
      return { id: `${code}:${saved.publicId}`, tone: "success", title: `${saved.label}'s mock set was changed.`, description: "Its views no one chose a set for apply it, and its current build is captured again." };
    case "preview-unreachable":
      return { id, tone: "error", title: `${saved.label} couldn't be read.`, description: "Nothing was queued. Check that the remote is reachable and the branch or tag exists, then try again." };
    default:
      return undefined;
  }
}
