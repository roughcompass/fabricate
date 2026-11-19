/** Which page skeleton matches the page at a path; null for paths with none. */
export type SkeletonKind = "home" | "list" | "repositories" | "detail" | "form" | "focused";

const RULES: [pattern: RegExp, kind: SkeletonKind][] = [
  [/^\/$/, "home"],
  [/^\/(assessments|repositories|standards)\/new\/?$/, "form"],
  [/^\/(assessments|repositories|standards)\/[^/]+\/edit\/?$/, "form"],
  // The Repositories list lays out its own toolbar and columns.
  [/^\/repositories\/?$/, "repositories"],
  [/^\/(assessments|standards)\/?$/, "list"],
  [/^\/repositories\/bulk\/?$/, "form"],
  [/^\/repositories\/[^/]+\/settings\/?$/, "form"],
  [/^\/admin\/bitbucket-tokens\/?$/, "list"],
  [/^\/admin\/bitbucket-tokens\/new\/?$/, "form"],
  // A Repository's page, its versions, and each version.
  [/^\/repositories\/src_[^/]+(\/versions(\/[^/]+)?)?\/?$/, "detail"],
  // A repository preview is a focused page, like template preview.
  [/^\/repositories\/src_[^/]+\/previews\/[^/]+\/?$/, "focused"],
  [/^\/(assessments|runs|evaluations|profiles|standards)\/[^/]+(\/.*)?$/, "detail"],
  // The template demo's operator pages; running applications have no skeleton.
  // Preview mode is a focused page: its skeleton hides the sidebar as soon as the navigation starts.
  [/^\/templates\/[^/]+\/preview\/?$/, "focused"],
  [/^\/templates\/?$/, "list"],
  [/^\/templates\/[^/]+\/?$/, "detail"],
];

export function skeletonFor(pathname: string): SkeletonKind | null {
  return RULES.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}
