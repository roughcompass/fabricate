import { type NextRequest, NextResponse } from "next/server";
import { WORKSPACE_COOKIE, WORKSPACE_COOKIE_MAX_AGE, isWorkspaceKey, newWorkspaceKey } from "@/lib/demo/workspace-key";

/**
 * Gives each template-demo visitor an anonymous workspace credential on their
 * first demo request (design.md, decision 3). It only issues the cookie: the
 * workspace row is created on the first write, and every demo page and
 * endpoint checks the demo switch itself, so a cookie issued while the demo is
 * disabled has no effect.
 */
export function proxy(request: NextRequest): NextResponse {
  if (isWorkspaceKey(request.cookies.get(WORKSPACE_COOKIE)?.value)) return NextResponse.next();

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
  matcher: ["/new/:path*", "/templates/:path*", "/applications/:path*", "/run/:path*", "/s/:path*", "/api/demo/:path*"],
};
