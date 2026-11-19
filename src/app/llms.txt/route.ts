import { llmsTxt, requestOrigin } from "@/lib/docs/agents";
import { docsSite } from "@/lib/docs/site";

// The docs' index for agents, in the llms.txt format.
export function GET(request: Request) {
  return new Response(llmsTxt(docsSite(), requestOrigin(request)), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
