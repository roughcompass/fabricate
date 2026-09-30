/** Which page skeleton matches the page at a path; null for paths with none. */
export type SkeletonKind = "list" | "detail" | "form";

const RULES: [pattern: RegExp, kind: SkeletonKind][] = [
  [/^\/(initiatives|sources|standards)\/new\/?$/, "form"],
  [/^\/(initiatives|sources|standards)\/[^/]+\/edit\/?$/, "form"],
  [/^\/(sources|standards)?\/?$/, "list"],
  [/^\/sources\/import\/?$/, "list"],
  [/^\/(initiatives|assessments|evaluations|profiles|standards)\/[^/]+(\/.*)?$/, "detail"],
];

export function skeletonFor(pathname: string): SkeletonKind | null {
  return RULES.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}
