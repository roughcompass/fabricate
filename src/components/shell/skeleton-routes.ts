/**
 * Which page skeleton matches the page at a path; null for paths with none.
 * Each is a template's skeleton (src/components/templates/), shaped as that
 * page lays out its template's zones.
 */
export type SkeletonKind = "dashboard" | "index" | "index-tabs" | "repositories" | "cards" | "details" | "details-tabs" | "analysis" | "form" | "editor" | "settings" | "focused" | "content";

const RULES: [pattern: RegExp, kind: SkeletonKind][] = [
  [/^\/((admin\/system|adoption)\/?)?$/, "dashboard"],
  [/^\/adoption\/design-systems\/[^/]+\/components\/[^/]+\/?$/, "details-tabs"],
  [/^\/adoption\/(design-systems|packages)\/.+$/, "analysis"],
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
  // Applications: the gallery's cards, an application's page and settings, and preview mode, a focused page.
  [/^\/applications\/?$/, "cards"],
  [/^\/applications\/[^/]+\/settings\/?$/, "settings"],
  [/^\/applications\/[^/]+\/preview\/?$/, "focused"],
  [/^\/applications\/(?!new\/?$)[^/]+\/?$/, "details"],
  // The template demo's operator pages; running applications have no skeleton.
  // Preview mode is a focused page: its skeleton hides the sidebar as soon as the navigation starts.
  [/^\/templates\/[^/]+\/preview\/?$/, "focused"],
  [/^\/templates\/?$/, "cards"],
  [/^\/templates\/[^/]+\/?$/, "details"],
  // The docs, on the Content template; the product page has no skeleton.
  [/^\/docs(\/.*)?$/, "content"],
];

export function skeletonFor(pathname: string): SkeletonKind | null {
  return RULES.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}
