/** Which page skeleton matches the page at a path; null for paths with none. */
export type SkeletonKind = "list" | "detail" | "form" | "focused";

const RULES: [pattern: RegExp, kind: SkeletonKind][] = [
  [/^\/(assessments|repositories|standards)\/new\/?$/, "form"],
  [/^\/(assessments|repositories|standards)\/[^/]+\/edit\/?$/, "form"],
  [/^\/(assessments|repositories|standards)?\/?$/, "list"],
  [/^\/repositories\/import\/?$/, "list"],
  [/^\/(assessments|runs|evaluations|profiles|standards)\/[^/]+(\/.*)?$/, "detail"],
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
