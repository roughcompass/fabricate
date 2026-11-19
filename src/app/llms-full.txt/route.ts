import { llmsFullTxt, requestOrigin } from "@/lib/docs/agents";
import { docsSite } from "@/lib/docs/site";

// Every docs page's Markdown, in reading order.
export function GET(request: Request) {
  return new Response(llmsFullTxt(docsSite(), requestOrigin(request)), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
