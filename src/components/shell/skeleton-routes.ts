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
  // Navigation: the list of Portals, New Portal, and each Portal's page.
  [/^\/navigation\/?$/, "list"],
  [/^\/navigation\/new\/?$/, "form"],
  // A Portal's experience editor is a focused workspace.
  [/^\/navigation\/[^/]+\/editor(\/.*)?$/, "focused"],
  // A Portal's and an Application's Edit details.
  [/^\/(navigation|applications)\/[^/]+\/edit\/?$/, "form"],
  [/^\/navigation\/[^/]+\/?$/, "detail"],
  // Add application, its full catalog, and Create Application are focused pages (page-patterns spec), like preview mode.
  [/^\/applications\/new(\/.*)?$/, "focused"],
  // The template demo's operator pages; running applications have no skeleton.
  [/^\/templates\/[^/]+\/deploy\/?$/, "form"],
  // Preview mode is a focused page: its skeleton hides the sidebar as soon as the navigation starts.
  [/^\/templates\/[^/]+\/preview\/?$/, "focused"],
  [/^\/(templates|applications)\/?$/, "list"],
  [/^\/(templates|applications)\/[^/]+\/?$/, "detail"],
];

export function skeletonFor(pathname: string): SkeletonKind | null {
  return RULES.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}
