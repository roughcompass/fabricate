import { type NextRequest, NextResponse } from "next/server";
import { WORKSPACE_COOKIE, WORKSPACE_COOKIE_MAX_AGE, isWorkspaceKey, newWorkspaceKey } from "@/lib/demo/workspace-key";
import { preferenceCookieRenames } from "@/lib/web/preference-cookies";

/**
 * Gives each visitor an anonymous workspace credential on their first request
 * to Applications, a running application, a share link, or the workspace's
 * endpoints, and to the template demo's pages until it's removed
 * (template-demo/demo-mode spec, "Each visitor works in an anonymous
 * workspace"). It only issues the cookie: the workspace row is created on the
 * first write, and every page and endpoint checks its own availability, so a
 * cookie issued while previews or the demo are off has no effect.
 *
 * It also moves preference cookies a browser still keeps under their names
 * from before the rename to their new names (lib/web/preference-cookies.ts).
 *
 * It also removes a trailing slash with a 308, as Next.js does by default.
 * next.config.ts turns that default off so a repository preview's root,
 * `/previews/<id>/`, keeps its slash and its relative references resolve
 * inside it. The matcher leaves `/previews/` alone (repository-previews
 * design, decision 6), so no preview path is redirected here or given a
 * workspace credential; the preview route adds the root's slash itself.
 */

/** Where a workspace credential is issued. */
const WORKSPACE_PATHS = /^\/(templates|applications|run|s|api\/workspace)(\/|$)/;

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  // A plain URL, since a NextURL keeps the trailing slash it was parsed with.
  if (pathname.length > 1 && pathname.endsWith("/")) return NextResponse.redirect(new URL(`${pathname.replace(/\/+$/, "") || "/"}${search}`, request.url), 308);
  const renames = preferenceCookieRenames(request.cookies);
  const key = WORKSPACE_PATHS.test(pathname) && !isWorkspaceKey(request.cookies.get(WORKSPACE_COOKIE)?.value) ? newWorkspaceKey() : null;
  if (key === null && renames.remove.length === 0) return NextResponse.next();

  // Forward the new cookies on this request too, so the page being rendered
  // already sees them.
  if (key !== null) request.cookies.set(WORKSPACE_COOKIE, key);
  for (const cookie of renames.set) request.cookies.set(cookie.name, cookie.value);
  for (const name of renames.remove) request.cookies.delete(name);
  const headers = new Headers(request.headers);
  headers.set("cookie", request.cookies.toString());

  const response = NextResponse.next({ request: { headers } });
  if (key !== null) {
    response.cookies.set({
      name: WORKSPACE_COOKIE,
      value: key,
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: WORKSPACE_COOKIE_MAX_AGE,
    });
  }
  for (const cookie of renames.set) response.cookies.set(cookie);
  for (const name of renames.remove) response.cookies.delete(name);
  return response;
}

export const config = {
  // Every request except Next's assets, the public files, the scripts the toolbar adds to a running application, and repository previews.
  matcher: ["/((?!_next/static|_next/image|demo/|toolbar/|previews/|icon\\.svg|favicon\\.ico).*)"],
};
