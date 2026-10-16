import { isPublicId } from "@/lib/db/ids";
import { getPrototypesDb } from "@/lib/prototypes/db/client";
import { prototypesUnavailable } from "@/lib/prototypes/guard";
import { latestTemplateVersion } from "@/lib/prototypes/templates";

const notFound = () => new Response("Not found", { status: 404 });

/** A neutral card image for a template whose image couldn't be captured, at the captured size. */
const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800"><rect width="1280" height="800" fill="#f2f4f6"/><rect x="0" y="0" width="1280" height="56" fill="#ffffff"/><rect x="0" y="56" width="240" height="744" fill="#ffffff"/><rect x="288" y="104" width="420" height="32" rx="4" fill="#dde1e5"/><rect x="288" y="168" width="944" height="400" rx="8" fill="#ffffff"/></svg>`;

/**
 * A template's preview image (design.md, decision 13): the PNG the frame
 * captured at 1280 × 800 when its latest version was accepted. Templates are shared
 * across the deployment, so any visitor may load one; a withdrawn template's
 * image answers not found.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const unavailable = prototypesUnavailable();
  if (unavailable) return unavailable;
  const { templateId } = await params;
  if (!isPublicId(templateId, "ptp")) return notFound();
  const version = await latestTemplateVersion(await getPrototypesDb(), templateId);
  if (!version) return notFound();
  // Accepting a later version changes the latest image, so it is revalidated on every use.
  const headers = { "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff" };
  if (!version.previewPng) return new Response(PLACEHOLDER, { headers: { ...headers, "Content-Type": "image/svg+xml" } });
  return new Response(new Uint8Array(version.previewPng), { headers: { ...headers, "Content-Type": "image/png" } });
}
