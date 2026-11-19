import { type Query, pageQuery, withQuery } from "./query";

/**
 * Every record's address (operator-interface/page-patterns spec). The
 * interface names records differently from the model: a model Initiative is
 * an Assessment, at /assessments; a model Assessment is a Run, at /runs; and
 * a Repository Source is a Repository, at /repositories. Pages, actions, and
 * the end-to-end specs build addresses here, so a change lands in one place.
 */
/** What a piece of evidence is reached through: a Run's public ID, or a Profile's. */
export type EvidenceOwner = { readonly run: string } | { readonly profile: string };

export const routes = {
  home: "/",

  assessments: "/assessments",
  newAssessment: "/assessments/new",
  assessment: (initiativeId: string, query?: Query) => withQuery(`/assessments/${initiativeId}`, query),
  assessmentEdit: (initiativeId: string, fragment?: string) => withQuery(`/assessments/${initiativeId}/edit`, {}, fragment),

  run: (assessmentId: string, query?: Query) => withQuery(`/runs/${assessmentId}`, query),
  runMap: (assessmentId: string, query?: Query) => withQuery(`/runs/${assessmentId}/map`, query),
  /** Evidence opens under its Run, or, reached from a Profile with no Run, under the Profile. */
  evidence: (owner: EvidenceOwner, evidenceId: string) => ("run" in owner ? `/runs/${owner.run}/evidence/${evidenceId}` : `/profiles/${owner.profile}/evidence/${evidenceId}`),
  runStatus: (assessmentId: string) => `/api/runs/${assessmentId}/status`,

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
  repository: (sourceId: string) => `/repositories/${sourceId}`,
  /** Its settings: its clone URL, name, and reference, and deleting it. */
  repositorySettings: (sourceId: string) => `/repositories/${sourceId}/settings`,
  /** Every version of it, its surveys, newest first. */
  repositoryVersions: (sourceId: string, page = 1) => withQuery(`/repositories/${sourceId}/versions`, { page: pageQuery(page) }),
  repositoryVersion: (sourceId: string, version: number) => `/repositories/${sourceId}/versions/${version}`,
  /** One of its previews (docs/previews.md): its device frame, state, and build log, with +query+ such as its device. */
  repositoryPreview: (sourceId: string, previewId: string, query?: Query) => withQuery(`/repositories/${sourceId}/previews/${previewId}`, query),
};
