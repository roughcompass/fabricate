/**
 * Which page skeleton matches the page at a path; null for paths with none.
 * Each is a template's skeleton (src/components/templates/), shaped as that
 * page lays out its template's zones.
 */
export type SkeletonKind = "dashboard" | "index" | "index-tabs" | "repositories" | "cards" | "details" | "details-tabs" | "analysis" | "form" | "editor" | "settings" | "focused";

const RULES: [pattern: RegExp, kind: SkeletonKind][] = [
  [/^\/(admin\/system\/?)?$/, "dashboard"],
  [/^\/(assessments|repositories|standards)\/new\/?$/, "form"],
  [/^\/(assessments|standards)\/[^/]+\/(edit|publish)\/?$/, "form"],
  [/^\/repositories\/bulk\/?$/, "form"],
  [/^\/admin\/bitbucket-tokens\/new\/?$/, "form"],
  // The Repositories list lays out its own filter bar and columns.
  [/^\/repositories\/?$/, "repositories"],
  // The Assessments list has a tab for each conclusion.
  [/^\/assessments\/?$/, "index-tabs"],
  [/^\/(standards|admin\/bitbucket-tokens)\/?$/, "index"],
  [/^\/repositories\/src_[^/]+\/versions\/?$/, "index"],
  [/^\/repositories\/src_[^/]+\/settings\/?$/, "settings"],
  // A Repository's page and each version show its Profile's views.
  [/^\/repositories\/src_[^/]+(\/versions\/[^/]+)?\/?$/, "details-tabs"],
  [/^\/profiles\/[^/]+\/?$/, "details-tabs"],
  // A repository preview is a focused page, like template preview.
  [/^\/repositories\/src_[^/]+\/previews\/[^/]+\/?$/, "focused"],
  [/^\/runs\/[^/]+\/map(\/.*)?$/, "analysis"],
  [/^\/standards\/[^/]+\/draft\/?$/, "editor"],
  [/^\/(assessments|runs|evaluations|profiles|standards)\/[^/]+(\/.*)?$/, "details"],
  // The template demo's operator pages; running applications have no skeleton.
  // Preview mode is a focused page: its skeleton hides the sidebar as soon as the navigation starts.
  [/^\/templates\/[^/]+\/preview\/?$/, "focused"],
  [/^\/templates\/?$/, "cards"],
  [/^\/templates\/[^/]+\/?$/, "details"],
];

export function skeletonFor(pathname: string): SkeletonKind | null {
  return RULES.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}
