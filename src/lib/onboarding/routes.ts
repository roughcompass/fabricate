/*
 * Portal routes (design decision 4). Normalization is structural: a route
 * needs its leading slash, repeated slashes collapse, a trailing slash is
 * dropped except on the root, and a query string or fragment is refused
 * because a route names a place, not a request. Matching is case-sensitive:
 * "/Payments" and "/payments" are different routes.
 */

export const MAX_ROUTE_LENGTH = 200;

export type RouteProblem = "empty" | "leading_slash" | "query" | "fragment" | "dot_segment" | "characters" | "too_long";

export const ROUTE_PROBLEMS: Record<RouteProblem, string> = {
  empty: "Enter a route, such as /payments",
  leading_slash: "A route starts with a slash, such as /payments",
  query: "A route can't contain a query string (?...)",
  fragment: "A route can't contain a fragment (#...)",
  dot_segment: 'A route can\'t contain a "." or ".." segment',
  characters: "A route uses letters, digits, and - . _ ~ ! $ & ' ( ) * + , ; = : @ %, with no spaces",
  too_long: `Use ${MAX_ROUTE_LENGTH} characters or fewer`,
};

/** Characters a path segment may hold (RFC 3986 pchar), case kept. */
const SEGMENT = /^[A-Za-z0-9\-._~!$&'()*+,;=:@%]*$/;

export type NormalizedRoute = { route: string; problem: null } | { route: null; problem: RouteProblem };

/** The normalized form of +input+, or why it isn't a route. */
export function normalizeRoute(input: string): NormalizedRoute {
  const value = input.trim();
  if (!value) return { route: null, problem: "empty" };
  if (value.includes("?")) return { route: null, problem: "query" };
  if (value.includes("#")) return { route: null, problem: "fragment" };
  if (!value.startsWith("/")) return { route: null, problem: "leading_slash" };
  const segments = value.split("/").filter((segment) => segment !== "");
  if (segments.some((segment) => segment === "." || segment === "..")) return { route: null, problem: "dot_segment" };
  if (segments.some((segment) => !SEGMENT.test(segment))) return { route: null, problem: "characters" };
  const route = `/${segments.join("/")}`;
  if (route.length > MAX_ROUTE_LENGTH) return { route: null, problem: "too_long" };
  return { route, problem: null };
}

/** True when +value+ is already a normalized route. */
export function isNormalizedRoute(value: string): boolean {
  return normalizeRoute(value).route === value;
}
