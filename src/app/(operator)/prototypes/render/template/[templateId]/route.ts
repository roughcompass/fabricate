import { isPublicId } from "@/lib/db/ids";
import { getPrototypesDb } from "@/lib/prototypes/db/client";
import { prototypesUnavailable } from "@/lib/prototypes/guard";
import { latestRechecks, latestTemplateVersion } from "@/lib/prototypes/templates";
import { previewState, renderResponse, requestOrigin } from "@/lib/prototypes/render";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * A template's frame (template-gallery spec, "The template detail page offers
 * Preview and Deploy"): its latest version's copy, in the shell it was
 * accepted with. It renders the latest re-check's compiled code, made for the
 * current runtime build, and answers not found when that build failed, since
 * code compiled for an earlier build can't be trusted to run (design.md,
 * decision 17). Templates are shared, so no workspace is needed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const unavailable = prototypesUnavailable();
  if (unavailable) return unavailable;
  const { templateId } = await params;
  if (!isPublicId(templateId, "ptp")) return notFound();
  const db = await getPrototypesDb();
  const version = await latestTemplateVersion(db, templateId);
  if (!version) return notFound();
  const recheck = (await latestRechecks(db, [version.id])).get(version.id) ?? null;
  const compiled = recheck ? recheck.compiled : version.snapshot.compiled;
  if (!compiled) return notFound();
  const { snapshot } = version;
  return renderResponse(
    { compiled, scope: "page", title: snapshot.title, navItem: snapshot.navItem, personas: snapshot.personas, shell: version.shell },
    previewState(new URL(request.url).searchParams),
    requestOrigin(request),
  );
}
