/**
 * Record addresses. The interface names records differently from the model
 * (operator-interface/page-patterns spec, content standard): a model
 * Initiative is an Assessment, at /assessments; a model Assessment is a Run,
 * at /runs; and a Repository Source is a Repository, at /repositories. Specs
 * build URLs here rather than by hand, so an address change lands in one place.
 */
export const paths = {
  assessments: "/assessments",
  newAssessment: "/assessments/new",
  assessment: (initiativeId: string) => `/assessments/${initiativeId}`,
  assessmentEdit: (initiativeId: string) => `/assessments/${initiativeId}/edit`,
  repositories: "/repositories",
  newRepository: "/repositories/new",
  importRepositories: "/repositories/import",
  repositoryEdit: (sourceId: string) => `/repositories/${sourceId}/edit`,
  run: (assessmentId: string) => `/runs/${assessmentId}`,
  runMap: (assessmentId: string) => `/runs/${assessmentId}/map`,
  evidence: (assessmentId: string, evidenceId: string) => `/runs/${assessmentId}/evidence/${evidenceId}`,
  runStatus: (assessmentId: string) => `/api/runs/${assessmentId}/status`,
};
