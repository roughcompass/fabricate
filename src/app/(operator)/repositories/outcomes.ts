import { countLabel } from "@/components/ui/count";
import type { Outcome } from "@/components/ui/outcome-toast";
import { findRepository, findRepositoryIncludingDeleted } from "@/lib/repositories/repository-records";
import type { Executor } from "@/lib/db/client";
import { findPreviewIncludingDeleted, packageLabel } from "@/lib/previews/views";
import { versionsOf } from "@/lib/profiling/versions";

/**
 * Messages for the outcome codes catalog actions redirect with. The URL carries
 * only a code, a Source ID, and counts; the text is built here from the
 * records, so a crafted link cannot inject text. An unknown code shows nothing.
 */
export function repositoryOutcome(db: Executor, code: string | undefined, repositoryPublicId: string | undefined, count?: string): Outcome | undefined {
  if (code === "bulk-added") {
    const created = Number.parseInt(count ?? "0", 10) || 0;
    return { id: `bulk-added:${created}`, tone: "success", title: `Added ${countLabel(created, "Repository", "Repositories")}.`, description: "Each is profiled in the background." };
  }

  const repository = repositoryPublicId ? (code === "deleted" ? findRepositoryIncludingDeleted : findRepository)(db, repositoryPublicId) : undefined;
  if (!code || !repository) return undefined;
  const id = `${code}:${repository.publicId}`;
  switch (code) {
    case "deleted":
      return { id, tone: "success", title: `${repository.name} was deleted.`, description: "Its past Run results stay with the Runs." };
    case "added":
      return { id, tone: "success", title: `${repository.name} was added.` };
    case "updated":
      return { id, tone: "success", title: `${repository.name} was updated.`, description: "Running and past Runs keep the configuration they started with." };
    case "reprofiled": {
      const latest = versionsOf(db, repository.id, 1)[0];
      return { id, tone: "success", title: latest ? `Version ${latest.version} of ${repository.name} is queued.` : `${repository.name} is queued for profiling.`, description: "Work people start runs first, so it may wait." };
    }
    case "profiling":
      return { id, tone: "info", title: `${repository.name} is already being profiled.`, description: "A new version can be queued once this one finishes." };
    case "current":
      return { id, tone: "info", title: `${repository.name}'s Profile is already up to date.`, description: "Its reference names the commit its current Profile describes, under the same Surveyor release and configuration." };
    case "unreachable":
      return { id, tone: "error", title: `${repository.name}'s reference couldn't be read.`, description: "Nothing was queued. Check its clone URL and reference, then try again." };
    default:
      return undefined;
  }
}

/** The URL parameters a preview's outcome travels in, removed once it shows. */
export const PREVIEW_OUTCOME_PARAMS = ["notice", "preview"] as const;

/**
 * Messages for the outcome codes preview actions redirect with: on the
 * preview's page, a build or rebuild queued; on the Repository's page, a
 * preview deleted. Built from the records, like sourceOutcome.
 */
export function previewOutcome(db: Executor, code: string | undefined, previewPublicId: string | undefined): Outcome | undefined {
  const preview = previewPublicId ? findPreviewIncludingDeleted(db, previewPublicId) : undefined;
  if (!code || !preview) return undefined;
  const id = `${code}:${preview.publicId}:${preview.attempt}`;
  const name = packageLabel(preview);
  switch (code) {
    case "queued":
      return preview.deletedAt ? undefined : { id, tone: "success", title: `The build of ${name} is queued.`, description: "It starts when a worker is free." };
    case "rebuilt":
      return preview.deletedAt ? undefined : { id, tone: "success", title: `Attempt ${preview.attempt} of ${name} is queued.`, description: preview.artifact ? "The current output stays up until the new build is ready." : undefined };
    case "building":
      return preview.deletedAt ? undefined : { id, tone: "info", title: `${name} is already building.`, description: "It can be rebuilt once this attempt finishes." };
    case "preview-deleted":
      return preview.deletedAt ? { id, tone: "success", title: `The preview of ${name} at ${preview.commitSha.slice(0, 12)} was deleted.`, description: "Its published output and build log were removed." } : undefined;
    default:
      return undefined;
  }
}
