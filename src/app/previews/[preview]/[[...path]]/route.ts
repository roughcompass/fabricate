import { servePreview } from "@/lib/previews/serving";

/*
 * A repository preview's published files, under /previews/<id>/ on
 * the Frontend Registry's own origin (docs/previews.md, "Serving"). Outside the operator
 * layout, GET and HEAD only, and every request checks the feature switch, the
 * preview, and its remote's enrollment again.
 */

type Context = { params: Promise<{ preview: string; path?: string[] }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { preview, path } = await params;
  return servePreview(request, preview, path ?? []);
}

export async function HEAD(request: Request, { params }: Context): Promise<Response> {
  const { preview, path } = await params;
  return servePreview(request, preview, path ?? []);
}
