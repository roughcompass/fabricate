import { countLabel } from "@/components/ui/format";
import { Notice } from "@/components/ui/notice";
import { findEnabledSourceByCanonicalUrl, findSource } from "@/lib/catalog/source-records";
import type { Executor } from "@/lib/db/client";

/**
 * Outcome notices after a catalog action. The URL carries only a code and a
 * source id; the message is built here, so a crafted link cannot inject text.
 */
export function ImportNotice({ code, count, failed }: { code?: string; count?: string; failed?: string }) {
  if (code !== "imported" && code !== "import-partial") return null;
  const created = Number.parseInt(count ?? "0", 10) || 0;
  const failures = Number.parseInt(failed ?? "0", 10) || 0;
  if (failures === 0) return <Notice tone="success" live>{`Added ${countLabel(created, "source")}.`}</Notice>;
  return (
    <Notice tone="warning" title={`Added ${created} of ${created + failures} selected sources.`}>
      <p>{`${countLabel(failures, "candidate")} could not be added. Preview the directory again to see why.`}</p>
    </Notice>
  );
}

export function SourceNotice({ db, code, sourcePublicId }: { db: Executor; code?: string; sourcePublicId?: string }) {
  const source = sourcePublicId ? findSource(db, sourcePublicId) : undefined;
  if (!code || !source) return null;

  switch (code) {
    case "added":
      return <Notice tone="success" live>{`${source.name} was added to the catalog.`}</Notice>;
    case "updated":
      return <Notice tone="success" live>{`${source.name} was updated. Running and past assessments keep their original configuration.`}</Notice>;
    case "enabled":
      return <Notice tone="success" live>{`${source.name} is enabled for future assessments.`}</Notice>;
    case "disabled":
      return <Notice tone="success" live>{`${source.name} is disabled. Past assessments that included it are unchanged.`}</Notice>;
    case "enable-conflict": {
      const existing = findEnabledSourceByCanonicalUrl(db, source.canonicalUrl, source.id);
      return (
        <Notice tone="error" title={`${source.name} could not be enabled.`}>
          <p>{existing ? `Its clone URL is already registered as ${existing.name} (${existing.publicId}). Disable that source first.` : "Another enabled source has the same clone URL."}</p>
        </Notice>
      );
    }
    default:
      return null;
  }
}
