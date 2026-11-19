import type { Choice } from "@/components/ui/form";
import { listSources, sourceReferenceLabel } from "@/lib/catalog/source-records";
import type { Executor } from "@/lib/db/client";
import { listSelectableReleases, releaseDocument, releaseLabel } from "@/lib/standards/standard-records";
import { countLabel } from "@/components/ui/count";
import { formatDate } from "@/components/ui/time";


/** Every Repository, to choose an explicit scope from. */
export function sourceChoices(db: Executor): Choice[] {
  return listSources(db).map((source) => ({ value: source.publicId, label: source.name, description: `${source.cloneUrl} · ${sourceReferenceLabel(source)}` }));
}

/** Every published Release. Drafts are never offered. */
export function releaseChoices(db: Executor): Choice[] {
  return listSelectableReleases(db).map(({ release, standard }) => {
    const controls = Array.isArray(releaseDocument(release).controls) ? (releaseDocument(release).controls as unknown[]).length : 0;
    return {
      value: release.publicId,
      label: releaseLabel(standard, release),
      description: `${countLabel(controls, "Control")} · published ${formatDate(release.publishedAt)} · digest ${release.digest.slice(0, 12)}`,
    };
  });
}
