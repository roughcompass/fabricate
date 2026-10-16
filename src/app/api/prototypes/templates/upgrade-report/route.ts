import { prototypesUnavailable } from "@/lib/prototypes/guard";
import { RUNTIME } from "@/lib/prototypes/render";
import { reportMarkdown, upgradeReportFor } from "@/lib/prototypes/upgrade-report";

/**
 * The upgrade report for a runtime build, `?runtime=<hash>` or the current
 * one, as JSON or, with `?format=md`, Markdown (template-conformance spec, "An
 * upgrade report lists every template's results"). It answers 409 while any
 * re-check for the build is pending, and 404 when none ran.
 */
export async function GET(request: Request) {
  const unavailable = prototypesUnavailable();
  if (unavailable) return unavailable;
  const query = new URL(request.url).searchParams;
  const runtime = query.get("runtime") ?? RUNTIME.hash;
  if (!/^[a-z0-9-]{1,64}$/.test(runtime)) return new Response(null, { status: 404 });
  const report = await upgradeReportFor(runtime);
  if (report === null) return Response.json({ error: "No template was re-checked for this runtime build." }, { status: 404 });
  if ("pending" in report) return Response.json({ error: `${report.pending} template re-checks for this runtime build are still running.`, pending: report.pending }, { status: 409, headers: { "Retry-After": "10" } });
  const name = `salt-patterns-upgrade-${report.saltRelease}-${runtime}`;
  if (query.get("format") === "md") {
    return new Response(reportMarkdown(report), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.md"`, "Cache-Control": "no-store" } });
  }
  return Response.json(report, { headers: { "Content-Disposition": `attachment; filename="${name}.json"`, "Cache-Control": "no-store" } });
}
