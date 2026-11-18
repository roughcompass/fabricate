import { countLabel } from "@/components/ui/count";
import type { Outcome } from "@/components/ui/outcome-toast";
import { findSource, findSourceIncludingDeleted } from "@/lib/catalog/source-records";
import type { Executor } from "@/lib/db/client";
import { versionsOf } from "@/lib/profiling/versions";

/**
 * Messages for the outcome codes catalog actions redirect with. The URL carries
 * only a code, a Source ID, and counts; the text is built here from the
 * records, so a crafted link cannot inject text. An unknown code shows nothing.
 */
export function sourceOutcome(db: Executor, code: string | undefined, sourcePublicId: string | undefined, count?: string): Outcome | undefined {
  if (code === "bulk-added") {
    const created = Number.parseInt(count ?? "0", 10) || 0;
    return { id: `bulk-added:${created}`, tone: "success", title: `Added ${countLabel(created, "Repository", "Repositories")}.`, description: "Each is profiled in the background." };
  }

  const source = sourcePublicId ? (code === "deleted" ? findSourceIncludingDeleted : findSource)(db, sourcePublicId) : undefined;
  if (!code || !source) return undefined;
  const id = `${code}:${source.publicId}`;
  switch (code) {
    case "deleted":
      return { id, tone: "success", title: `${source.name} was deleted.`, description: "Its past Run results stay with the Runs." };
    case "added":
      return { id, tone: "success", title: `${source.name} was added.` };
    case "updated":
      return { id, tone: "success", title: `${source.name} was updated.`, description: "Running and past Runs keep the configuration they started with." };
    case "reprofiled": {
      const latest = versionsOf(db, source.id, 1)[0];
      return { id, tone: "success", title: latest ? `Version ${latest.version} of ${source.name} is queued.` : `${source.name} is queued for profiling.`, description: "Work people start runs first, so it may wait." };
    }
    case "profiling":
      return { id, tone: "info", title: `${source.name} is already being profiled.`, description: "A new version can be queued once this one finishes." };
    default:
      return undefined;
  }
}
