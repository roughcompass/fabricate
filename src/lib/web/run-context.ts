import type { Assessment } from "@/lib/assessments/assessment-records";
import type { Executor } from "@/lib/db/client";
import type { Initiative } from "@/lib/initiatives/initiative-records";
import { versionOfAssessment } from "@/lib/profiling/versions";
import { routes } from "@/lib/web/routes";

export interface RunContext {
  /** The Run's name: "Run #3", or for a profile version's Run, "Run of version 3". */
  readonly name: string;
  /** Where the Run sits: its Assessment, or for a profile version, its Repository and version (docs/profiling.md). */
  readonly parents: readonly { readonly href: string; readonly label: string }[];
  /** What the browser title names after the Run: its Assessment, or its Repository. */
  readonly owner: string;
}

/** How pages under a Run name it and lead back to it. A Repository profiling Run is shown under Repositories, never under Assessments. */
export function runContext(db: Executor, assessment: Pick<Assessment, "id">, initiative: Pick<Initiative, "publicId" | "name" | "profiling">, number: number): RunContext {
  const version = initiative.profiling ? versionOfAssessment(db, assessment.id) : null;
  if (version) {
    return {
      name: `Run of version ${version.version}`,
      parents: [
        { href: "/repositories", label: "Repositories" },
        { href: routes.repository(version.sourcePublicId), label: version.sourceName },
        { href: routes.repositoryVersion(version.sourcePublicId, version.version), label: `Version ${version.version}` },
      ],
      owner: version.sourceName,
    };
  }
  return {
    name: `Run #${number}`,
    parents: [
      { href: "/assessments", label: "Assessments" },
      { href: routes.assessment(initiative.publicId), label: initiative.name },
    ],
    owner: initiative.name,
  };
}
