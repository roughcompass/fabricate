import type { Choice } from "@/components/ui/form";
import { listSources, sourceReferenceLabel } from "@/lib/catalog/source-records";
import type { Executor } from "@/lib/db/client";
import { listSelectableReleases, releaseDocument, releaseLabel } from "@/lib/standards/standard-records";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

/**
 * Enabled sources plus any disabled source the initiative still selects, so the
 * operator can see and remove a selection that would block assessment.
 */
export function sourceChoices(db: Executor, selectedPublicIds: readonly string[]): Choice[] {
  const selected = new Set(selectedPublicIds);
  return listSources(db)
    .filter((source) => source.enabled || selected.has(source.publicId))
    .map((source) => ({
      value: source.publicId,
      label: source.name,
      description: source.enabled ? `${source.cloneUrl} · ${sourceReferenceLabel(source)}` : "Disabled. Assessments are blocked until it is enabled or removed.",
    }));
}

/** Every published Release. Drafts are never offered. */
export function releaseChoices(db: Executor): Choice[] {
  return listSelectableReleases(db).map(({ release, standard }) => {
    const controls = Array.isArray(releaseDocument(release).controls) ? (releaseDocument(release).controls as unknown[]).length : 0;
    return {
      value: release.publicId,
      label: releaseLabel(standard, release),
      description: `${controls} ${controls === 1 ? "Control" : "Controls"} · published ${dateFormat.format(release.publishedAt)} · digest ${release.digest.slice(0, 12)}`,
    };
  });
}
