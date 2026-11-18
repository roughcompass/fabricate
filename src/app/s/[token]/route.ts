import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { referenceId, routeByPath, startRoute, templateBySlug } from "@/lib/demo/catalog";
import { demoUnavailable } from "@/lib/demo/guard";
import { shareCookieName } from "@/lib/demo/runtime-view";
import { findShare } from "@/lib/demo/shares";
import { WORKSPACE_COOKIE_MAX_AGE } from "@/lib/demo/workspace-key";

/**
 * A share link that no longer resolves opens the running application's
 * not-found page, which offers a way back (page-patterns spec), rather than a
 * bare 404. A relative Location keeps the browser on the host it used.
 */
const notFound = () => new NextResponse(null, { status: 303, headers: { Location: "/run/unavailable" } });

/**
 * Opens a share link: remembers its token for the application in an httpOnly
 * cookie (the runtime renders from a layout, which cannot read query
 * parameters) and redirects to the shared route (design.md, decision 11).
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const unavailable = demoUnavailable();
  if (unavailable) return unavailable;
  const { token } = await params;
  const share = findShare(getDb(), token);
  const template = share && templateBySlug(share.referenceSlug);
  if (!share || !template) return notFound();
  const applicationId = referenceId(template.slug);

  const route = routeByPath(template.app, share.state.route) ?? startRoute(template.app);
  // A relative Location keeps the browser on the host it used, where its cookies are.
  const response = new NextResponse(null, { status: 303, headers: { Location: `/run/${applicationId}/${route.path}` } });
  response.cookies.set({
    name: shareCookieName(applicationId),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: WORKSPACE_COOKIE_MAX_AGE,
  });
  return response;
}
