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
  /** New preview: saves a preview of one of the application's branches or tags (restore-toolbar-tools-and-branch-previews, task 3.2). */
  newApplicationPreview: (slug: string, query?: Query) => withQuery(`/applications/${slug}/previews/new`, query),
  /**
   * An application's mock sets (add-mock-sets, design decision 18): the application page's section,
   * a set's page, its rule forms, New mock set, Edit mock set, Upload HAR, an upload's review, and a
   * saved preview's choice of set.
   */
  applicationMockSets: (slug: string) => withQuery(`/applications/${slug}`, {}, "mock-sets"),
  mockSet: (slug: string, set: string, query?: Query) => withQuery(`/applications/${slug}/mock-sets/${set}`, query),
  newMockSet: (slug: string, query?: Query) => withQuery(`/applications/${slug}/mock-sets/new`, query),
  mockSetEdit: (slug: string, set: string) => `/applications/${slug}/mock-sets/${set}/edit`,
  newMockRule: (slug: string, set: string, query?: Query) => withQuery(`/applications/${slug}/mock-sets/${set}/rules/new`, query),
  mockRule: (slug: string, set: string, rule: string) => `/applications/${slug}/mock-sets/${set}/rules/${rule}`,
  mockSetUpload: (slug: string, query?: Query) => withQuery(`/applications/${slug}/mock-sets/upload`, query),
  mockSetImport: (slug: string, draft: string, query?: Query) => withQuery(`/applications/${slug}/mock-sets/imports/${draft}`, query),
  savedPreviewMockSet: (slug: string, key: string) => `/applications/${slug}/previews/${key}/mock-set`,
  /**
   * The mock sets' endpoints: the sets with a view's active set, creating one, a visitor's choice,
   * a set's rules, its compiled rules by revision and its bodies by digest, uploads, and export.
   */
  mockSetsApi: (slug: string, query?: Query) => withQuery(`/api/applications/${slug}/mock-sets`, query),
  mockSetChoiceApi: (slug: string) => `/api/applications/${slug}/mock-sets/choice`,
  mockRulesApi: (slug: string, set: string) => `/api/applications/${slug}/mock-sets/${set}/rules`,
  compiledMockSet: (slug: string, set: string, revision?: number) => withQuery(`/api/applications/${slug}/mock-sets/${set}/compiled`, { ...(revision !== undefined && { revision: String(revision) }) }),
  mockSetBody: (slug: string, set: string, digest: string) => `/api/applications/${slug}/mock-sets/${set}/bodies/${digest}`,
  mockSetImportsApi: (slug: string) => `/api/applications/${slug}/mock-sets/imports`,
  mockSetHar: (slug: string, set: string) => `/api/applications/${slug}/mock-sets/${set}/har`,
  /** The status of the applications a page shows, which it polls while one is building. */
  applicationsStatus: (publicIds: readonly string[]) => withQuery("/api/applications/status", { ids: publicIds.join(",") }),
  /**
   * An application running full screen under the toolbar, at +path+ within it (add-applications task 8.1): `accounts/42` or `/accounts/42`, with +query+ such as a share link's token.
   * With +key+, one of its saved previews: `/run/<slug>@<key>/…` (restore-toolbar-tools-and-branch-previews, design decision 4).
   */
  runningApplication: (slug: string, route = "", query?: Query, key?: string | null) => runningAddress(key ? `${slug}@${key}` : slug, route, query),
  /** An application's current screenshot, or its card image, at +version+ (Application.screenshot.version) so a new one loads anew; with +key+, one of its saved previews'. */
  applicationScreenshot: (slug: string, version: string, size: "full" | "card" = "full", key?: string | null) => withQuery(`/applications/${slug}/screenshot`, { ...(key && { preview: key }), ...(size === "card" && { size }), v: version }),

  /** Adoption Analytics: the tracked design systems and packages. */
  adoption: "/adoption",
  adoptionDesignSystem: (designSystemId: string, query?: Query) => withQuery(`/adoption/design-systems/${designSystemId}`, query),
  adoptionComponent: (designSystemId: string, name: string, query?: Query) => withQuery(`/adoption/design-systems/${designSystemId}/components/${encodeURIComponent(name)}`, query),
  /** A package's versions across the fleet; a scoped name keeps its @ and slash, as /adoption/packages/@salt-ds/core. */
  adoptionPackage: (name: string, query?: Query) => withQuery(`/adoption/packages/${name.split("/").map((part) => encodeURIComponent(part).replace(/^%40/, "@")).join("/")}`, query),
};

/**
 * The application and saved preview a `/run/<segment>` address names
 * (restore-toolbar-tools-and-branch-previews, design decision 4): the
 * segment split at its first `@`, which a slug can't hold, so
 * `orders-portal@feature-new-nav` is the saved preview `feature-new-nav` of
 * `orders-portal`. An encoded `@` is read as one.
 */
export function parseRunSegment(segment: string): { slug: string; key: string | null } {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // A malformed escape names no application.
  }
  const at = decoded.indexOf("@");
  return at === -1 ? { slug: decoded, key: null } : { slug: decoded.slice(0, at), key: decoded.slice(at + 1) };
}

/**
 * A running application's address for +route+, an application route that
 * may carry the application's own query, such as `/accounts?tab=billing`,
 * which the address keeps, every parameter as it was. +query+, such as a
 * share link's token, is added after it, and replaces a parameter of the
 * same name.
 */
function runningAddress(segment: string, route: string, query: Query = {}): string {
  const mark = route.indexOf("?");
  const path = (mark === -1 ? route : route.slice(0, mark)).replace(/^\/+/, "");
  const params = new URLSearchParams(mark === -1 ? "" : route.slice(mark + 1));
  for (const [key, value] of Object.entries(query)) if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  return `/run/${segment}${path ? `/${path}` : ""}${params.size ? `?${params}` : ""}`;
}

