import { type NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { WORKSPACE_COOKIE, WORKSPACE_COOKIE_MAX_AGE, isWorkspaceKey, newWorkspaceKey } from "@/lib/demo/workspace-key";

/**
 * Two jobs at DE FabLab's edge.
 *
 * It gives each visitor an anonymous workspace credential on their first
 * template demo or Prototypes request (design.md, decision 3; Prototypes
 * design.md, decision 2). Both areas key their workspaces by the same cookie,
 * so a browser has one identity in both. The proxy only issues the cookie:
 * the demo creates its workspace row on the first write, and Prototypes on
 * its first request. Every page and endpoint checks its area's switch
 * itself, so a cookie issued while an area is disabled has no effect.
 *
 * In the hosted profile (Prototypes design.md, decision 4), it answers not
 * found for everything outside Prototypes, and sends / to /prototypes.
 */

/** Where a workspace credential is issued. */
const WORKSPACE_PATHS = /^\/(templates|run|s|api\/demo|prototypes|api\/prototypes|p)(\/|$)/;

/** What the hosted profile serves: Prototypes, its APIs and share links, Workflow's endpoints, health, and the self-guarded test routes. */
const HOSTED_PATHS = /^\/(prototypes|api\/prototypes|p|\.well-known\/workflow|api\/health|api\/test)(\/|$)/;

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (getConfig().profile === "hosted") {
    if (pathname === "/") return NextResponse.redirect(new URL("/prototypes", request.url));
    if (!HOSTED_PATHS.test(pathname)) return new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
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
  // Every request except Next's assets and the public files, which the hosted profile serves too.
  matcher: ["/((?!_next/static|_next/image|prototype-runtime/|demo/|icon\\.svg|favicon\\.ico).*)"],
};
