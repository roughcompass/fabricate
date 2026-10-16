/** Which page skeleton matches the page at a path; null for paths with none. */
export type SkeletonKind = "home" | "list" | "detail" | "form" | "focused";

const RULES: [pattern: RegExp, kind: SkeletonKind][] = [
  [/^\/$/, "home"],
  [/^\/(assessments|repositories|standards)\/new\/?$/, "form"],
  [/^\/(assessments|repositories|standards)\/[^/]+\/edit\/?$/, "form"],
  [/^\/(assessments|repositories|standards)\/?$/, "list"],
  [/^\/repositories\/import\/?$/, "list"],
  [/^\/repositories\/de-console\/?$/, "detail"],
  [/^\/(assessments|runs|evaluations|profiles|standards)\/[^/]+(\/.*)?$/, "detail"],
  // Web onboarding: its catalogs and the review queue, its create and Draft forms, and its records.
  [/^\/onboarding\/(portals|applications)\/new\/?$/, "form"],
  [/^\/onboarding\/applications\/[^/]+\/microfrontends\/new\/?$/, "form"],
  [/^\/onboarding\/(portals|applications|microfrontends)\/[^/]+\/draft(\/.*)?$/, "form"],
  [/^\/onboarding(\/(portals|applications|microfrontends|reviews))?\/?$/, "list"],
  [/^\/onboarding\/(portals|applications|microfrontends|reviews)\/[^/]+(\/.*)?$/, "detail"],
  // The template demo's operator pages; running applications have no skeleton.
  [/^\/templates\/[^/]+\/deploy\/?$/, "form"],
  // Preview mode is a focused page: its skeleton hides the sidebar as soon as the navigation starts.
  [/^\/templates\/[^/]+\/preview\/?$/, "focused"],
  [/^\/applications\/import\/?$/, "list"],
  [/^\/applications\/import\/[^/]+\/[^/]+\/?$/, "form"],
  [/^\/new\/?$/, "list"],
  [/^\/(templates|applications)\/?$/, "list"],
  [/^\/(templates|applications)\/[^/]+\/?$/, "detail"],
];

export function skeletonFor(pathname: string): SkeletonKind | null {
  return RULES.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}
