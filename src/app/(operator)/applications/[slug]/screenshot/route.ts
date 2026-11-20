import { screenshotSize, serveScreenshot } from "@/lib/applications/images";

/*
 * An application's screenshot, or with ?size=card its card image, from its
 * current build (add-applications, design decision 4); with ?preview=<key>,
 * one of its saved previews' (restore-toolbar-tools-and-branch-previews,
 * task 2.3). Answers not found while previews are off, for an unknown key,
 * and until a screenshot is captured.
 */

type Context = { params: Promise<{ slug: string }> };

function serve(request: Request, slug: string): Promise<Response> {
  const query = new URL(request.url).searchParams;
  return serveScreenshot(request, slug, screenshotSize(query.get("size")), { key: query.get("preview") });
}

export async function GET(request: Request, { params }: Context): Promise<Response> {
  return serve(request, (await params).slug);
}

export async function HEAD(request: Request, { params }: Context): Promise<Response> {
  return serve(request, (await params).slug);
}
