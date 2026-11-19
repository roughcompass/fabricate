import { type Query, pageQuery, withQuery } from "./query";

/**
 * Every record's address (operator-interface/page-patterns spec): an
 * Assessment at /assessments, a Run at /runs, and a Repository at
 * /repositories. Pages, actions, and the end-to-end specs build addresses
 * here, so a change lands in one place.
 */
/** What a piece of evidence is reached through: a Run's public ID, or a Profile's. */
export type EvidenceOwner = { readonly run: string } | { readonly profile: string };

export const routes = {
  home: "/",

  assessments: "/assessments",
  newAssessment: "/assessments/new",
  assessment: (assessmentId: string, query?: Query) => withQuery(`/assessments/${assessmentId}`, query),
  assessmentEdit: (assessmentId: string, fragment?: string) => withQuery(`/assessments/${assessmentId}/edit`, {}, fragment),

  run: (runId: string, query?: Query) => withQuery(`/runs/${runId}`, query),
  runMap: (runId: string, query?: Query) => withQuery(`/runs/${runId}/map`, query),
  /** Evidence opens under its Run, or, reached from a Profile with no Run, under the Profile. */
  evidence: (owner: EvidenceOwner, evidenceId: string) => ("run" in owner ? `/runs/${owner.run}/evidence/${evidenceId}` : `/profiles/${owner.profile}/evidence/${evidenceId}`),
  runStatus: (runId: string) => `/api/runs/${runId}/status`,

  evaluation: (evaluationId: string, query?: Query) => withQuery(`/evaluations/${evaluationId}`, query),
  finding: (evaluationId: string, findingId: string) => `/evaluations/${evaluationId}/findings/${findingId}`,
  evaluationStatus: (evaluationId: string) => `/api/evaluations/${evaluationId}/status`,

  profile: (profileId: string) => `/profiles/${profileId}`,

  standards: "/standards",
  newStandard: "/standards/new",
  standard: (standardId: string, query?: Query) => withQuery(`/standards/${standardId}`, query),
  standardEdit: (standardId: string) => `/standards/${standardId}/edit`,
  standardDraft: (standardId: string, query?: Query) => withQuery(`/standards/${standardId}/draft`, query),
  standardPublish: (standardId: string, query?: Query) => withQuery(`/standards/${standardId}/publish`, query),
  release: (standardId: string, releaseId: string, query?: Query) => withQuery(`/standards/${standardId}/releases/${releaseId}`, query),

  repositories: "/repositories",
  newRepository: "/repositories/new",
  bulkRepositories: "/repositories/bulk",
  /** The Repository's page, which shows its current Profile (docs/profiling.md). */
  repository: (repositoryId: string) => `/repositories/${repositoryId}`,
  /** Its settings: its clone URL, name, and reference, and deleting it. */
  repositorySettings: (repositoryId: string) => `/repositories/${repositoryId}/settings`,
  /** Every version of it, its surveys, newest first. */
  repositoryVersions: (repositoryId: string, page = 1) => withQuery(`/repositories/${repositoryId}/versions`, { page: pageQuery(page) }),
  repositoryVersion: (repositoryId: string, version: number) => `/repositories/${repositoryId}/versions/${version}`,
  /** One of its previews (docs/previews.md): its device frame, state, and build log, with +query+ such as its device. */
  repositoryPreview: (repositoryId: string, previewId: string, query?: Query) => withQuery(`/repositories/${repositoryId}/previews/${previewId}`, query),
};
