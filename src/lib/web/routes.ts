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
  /** Its current Profile's fact document, as stored, for an agent (product-site spec, "A Repository's current Profile is readable as JSON"). */
  repositoryProfileJson: (repositoryId: string) => `/repositories/${repositoryId}/profile.json`,
  /** One of its previews (docs/previews.md): its device frame, state, and build log, with +query+ such as its device. */
  repositoryPreview: (repositoryId: string, previewId: string, query?: Query) => withQuery(`/repositories/${repositoryId}/previews/${previewId}`, query),

  /** Applications (add-applications): the gallery, onboarding, and each application's page, settings, and preview mode by its slug. */
  applications: "/applications",
  newApplication: (query?: Query) => withQuery("/applications/new", query),
  application: (slug: string, query?: Query) => withQuery(`/applications/${slug}`, query),
  applicationSettings: (slug: string, query?: Query) => withQuery(`/applications/${slug}/settings`, query),
  applicationPreview: (slug: string, query?: Query) => withQuery(`/applications/${slug}/preview`, query),
  /** The status of the applications a page shows, which it polls while one is building. */
  applicationsStatus: (publicIds: readonly string[]) => withQuery("/api/applications/status", { ids: publicIds.join(",") }),
  /** An application running full screen under the toolbar, at +path+ within it (add-applications task 8.1). */
  runningApplication: (slug: string, path = "") => `/run/${slug}${path ? `/${path.replace(/^\/+/, "")}` : ""}`,
  /** An application's current screenshot, or its card image, at +version+ (Application.screenshot.version) so a new one loads anew. */
  applicationScreenshot: (slug: string, version: string, size: "full" | "card" = "full") => withQuery(`/applications/${slug}/screenshot`, { ...(size === "card" && { size }), v: version }),
  /** The application running full screen under the toolbar, at its own +route+ (`/accounts/42`), with +query+ such as a share link's token. */
  runningApplication: (slug: string, route = "/", query?: Query) => withQuery(`/run/${slug}${route === "/" ? "" : route}`, query),

  /** Adoption Analytics: the tracked design systems and packages. */
  adoption: "/adoption",
  adoptionDesignSystem: (designSystemId: string, query?: Query) => withQuery(`/adoption/design-systems/${designSystemId}`, query),
  adoptionComponent: (designSystemId: string, name: string, query?: Query) => withQuery(`/adoption/design-systems/${designSystemId}/components/${encodeURIComponent(name)}`, query),
  /** A package's versions across the fleet; a scoped name keeps its @ and slash, as /adoption/packages/@salt-ds/core. */
  adoptionPackage: (name: string, query?: Query) => withQuery(`/adoption/packages/${name.split("/").map((part) => encodeURIComponent(part).replace(/^%40/, "@")).join("/")}`, query),
};
