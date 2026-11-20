import { NextResponse } from "next/server";
import { applicationsAvailable } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { sharedApplication } from "@/lib/demo/access";
import { findShare } from "@/lib/demo/shares";
import { routes } from "@/lib/web/routes";

/**
 * Opens a share link (template-demo/toolbar spec, "Shared links open the
 * captured view"): the application running at the captured route, with the
 * token in the address, so the page opens the shared view's comments and
 * the captured commit's build, or the current build when that one is gone.
 * A link that no longer resolves, because the sharer reset their workspace
 * or the application was deleted, and any link while previews are off, opens
 * the running application's not-found page, which offers a way back
 * (page-patterns spec, "Share links that no longer resolve lead back to
 * Applications") and shows nothing of the application. Relative Locations
 * keep the browser on the host it used.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const share = applicationsAvailable() ? findShare(db, token) : null;
  const application = share && sharedApplication(db, share);
  const location = share && application ? routes.runningApplication(application.slug, share.route, { share: token }) : "/run/unavailable";
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}
