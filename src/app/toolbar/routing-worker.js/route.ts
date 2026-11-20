import { ROUTING_WORKER_SOURCE } from "@/components/toolbar/routing/routing-worker.generated";

/**
 * The routing service worker (restore-toolbar-tools-and-branch-previews,
 * design decision 7), which the toolbar registers with the scope of the
 * build it routes, `/previews/<build>/`. `Service-Worker-Allowed` lets a
 * script served from here take a scope under /previews/, and `no-cache` makes
 * every browser that has it check for a newer one on its next update. Serving
 * under /previews/ is unchanged: no build's own response gains the header.
 */
export function GET() {
  return new Response(ROUTING_WORKER_SOURCE, {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Service-Worker-Allowed": "/previews/", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" },
  });
}
