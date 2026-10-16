import { isPublicId } from "@/lib/db/ids";
import { archiveName, projectArchive } from "@/lib/prototypes/export";
import { prototypesUnavailable } from "@/lib/prototypes/guard";
import { existingPrototypesRequest } from "@/lib/prototypes/request";
import { exportedPrototypeVersion } from "@/lib/prototypes/template-files";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * Downloads a version as a runnable project (sharing-and-export spec, "A
 * version downloads as a runnable project"), in the workspace's current shell.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const unavailable = prototypesUnavailable();
  if (unavailable) return unavailable;
  const { versionId } = await params;
  if (!isPublicId(versionId, "ver")) return notFound();
  const context = await existingPrototypesRequest();
  if (!context) return notFound();
  const exported = await exportedPrototypeVersion(context.db, versionId, context.workspace.id);
  if (!exported) return notFound();
  const archive = projectArchive(exported);
  return new Response(new Uint8Array(archive), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${archiveName(exported.prototypeName, exported.number)}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
