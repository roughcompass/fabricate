import { docsSite, findPage, pageMarkdown } from "@/lib/docs/site";

// A docs page's Markdown, exactly as written. next.config.ts sends `/docs/<path>.md`, and a docs address requested with `Accept: text/markdown`, here.
export async function GET(_request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const site = docsSite();
  const page = findPage(site, path.join("/"));
  if (!page) return new Response("No docs page has this address.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(pageMarkdown(site, page), { headers: { "Content-Type": "text/markdown; charset=utf-8", Vary: "Accept" } });
}
