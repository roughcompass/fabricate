import type { Choice } from "@/components/ui/form";
import { listRepositories, repositoryReferenceLabel } from "@/lib/repositories/repository-records";
import type { Executor } from "@/lib/db/client";
import { listSelectableReleases, releaseDocument, releaseLabel } from "@/lib/standards/standard-records";
import { countLabel } from "@/components/ui/count";
import { formatDate } from "@/components/ui/time";


/** Every Repository, to choose an explicit scope from. */
export function repositoryChoices(db: Executor): Choice[] {
  return listRepositories(db).map((repository) => ({ value: repository.publicId, label: repository.name, description: `${repository.cloneUrl} · ${repositoryReferenceLabel(repository)}` }));
}

/** Every published Release. Drafts are never offered. */
export function releaseChoices(db: Executor): Choice[] {
  return listSelectableReleases(db).map(({ release, standard }) => {
    const controls = Array.isArray(releaseDocument(release).controls) ? (releaseDocument(release).controls as unknown[]).length : 0;
    return {
      value: release.publicId,
      label: releaseLabel(standard, release),
      // Its digest is in the Release's details, not here (page-patterns spec, "Digests out of the overview").
      description: `${countLabel(controls, "Control")} · published ${formatDate(release.publishedAt)}`,
    };
  });
}
