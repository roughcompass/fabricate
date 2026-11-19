import { type NextRequest, NextResponse } from "next/server";
import { WORKSPACE_COOKIE, WORKSPACE_COOKIE_MAX_AGE, isWorkspaceKey, newWorkspaceKey } from "@/lib/demo/workspace-key";

/**
 * Gives each template-demo visitor an anonymous workspace credential on their
 * first demo request (design.md, decision 3). It only issues the cookie: the
 * workspace row is created on the first write, and every demo page and
 * endpoint checks the demo switch itself, so a cookie issued while the demo is
 * disabled has no effect.
 *
 * It also removes a trailing slash with a 308, as Next.js does by default.
 * next.config.ts turns that default off so a repository preview's root,
 * `/previews/<id>/`, keeps its slash and its relative references resolve
 * inside it. The matcher leaves `/previews/` alone (repository-previews
 * design, decision 6), so no preview path is redirected here or given a
 * workspace credential; the preview route adds the root's slash itself.
 */

/** Where a workspace credential is issued. */
const WORKSPACE_PATHS = /^\/(templates|run|s|api\/demo)(\/|$)/;

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  // A plain URL, since a NextURL keeps the trailing slash it was parsed with.
  if (pathname.length > 1 && pathname.endsWith("/")) return NextResponse.redirect(new URL(`${pathname.replace(/\/+$/, "") || "/"}${search}`, request.url), 308);
  if (!WORKSPACE_PATHS.test(pathname) || isWorkspaceKey(request.cookies.get(WORKSPACE_COOKIE)?.value)) return NextResponse.next();

  const key = newWorkspaceKey();
  // Forward the new cookie on this request too, so the page being rendered
  // already sees the workspace.
  request.cookies.set(WORKSPACE_COOKIE, key);
  const headers = new Headers(request.headers);
  headers.set("cookie", request.cookies.toString());

  const response = NextResponse.next({ request: { headers } });
  response.cookies.set({
    name: WORKSPACE_COOKIE,
    value: key,
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: WORKSPACE_COOKIE_MAX_AGE,
  });
  return response;
}

export const config = {
  // Every request except Next's assets, the public files, and repository previews.
  matcher: ["/((?!_next/static|_next/image|demo/|previews/|icon\\.svg|favicon\\.ico).*)"],
};
