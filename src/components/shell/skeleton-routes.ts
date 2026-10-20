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
  // Runtime Configuration: the Portals page, New Portal, each Portal's page, and its editor and configuration pages, all inside the shell.
  [/^\/portals\/?$/, "list"],
  [/^\/portals\/new\/?$/, "form"],
  // A Portal's and an Application's Edit details.
  [/^\/(portals|applications)\/[^/]+\/edit\/?$/, "form"],
  [/^\/portals\/[^/]+(\/.*)?$/, "detail"],
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
