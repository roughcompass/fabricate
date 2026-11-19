import { screenshotSize, serveScreenshot } from "@/lib/applications/images";

/*
 * An application's screenshot, or with ?size=card its card image, from its
 * current build (add-applications, design decision 4). Answers not found
 * while previews are off, and until a screenshot is captured.
 */

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { slug } = await params;
  return serveScreenshot(request, slug, screenshotSize(new URL(request.url).searchParams.get("size")));
}

export async function HEAD(request: Request, { params }: Context): Promise<Response> {
  const { slug } = await params;
  return serveScreenshot(request, slug, screenshotSize(new URL(request.url).searchParams.get("size")));
}
