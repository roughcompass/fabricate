import axe from "axe-core/axe.min.js";

/**
 * axe-core, as the Accessibility tool adds it to a running application's page
 * (add-applications, design decision 6): the source of the library's minified
 * build, which it provides for running inside another page. Node loads
 * axe-core unbundled (next.config.ts), so the text is the published library's.
 */
export function GET() {
  return new Response(axe.source, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
