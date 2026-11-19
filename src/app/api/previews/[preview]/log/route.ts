import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { openPreview } from "@/lib/previews/access";
import { readLogChunk } from "@/lib/previews/log";
import { settleAbandonedAttempts } from "@/lib/previews/records";

/*
 * A preview's latest attempt log, read by offset (design decision 9): with
 * `from` and `log`, the whole lines written after `from` to the log named
 * `log`; without them, or when `log` names an earlier attempt's log, the
 * current log's tail, marked `reset`. The answer names the attempt, its log,
 * and its state, so the page knows when to start over and when the build
 * finished. The same gate as the preview's page and files: not found unless
 * previews are on, the preview exists, and its remote is enrolled.
 */
export async function GET(request: Request, { params }: { params: Promise<{ preview: string }> }) {
  const { preview: publicId } = await params;
  const db = getDb();
  const config = getConfig();
  if (isPublicId(publicId, "pvw")) settleAbandonedAttempts(db, { publicId });
  const opened = openPreview(db, config, publicId);
  if (!opened) return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

  const query = new URL(request.url).searchParams;
  const from = Number(query.get("from"));
  const log = query.get("log");
  const chunk = await readLogChunk(config, opened.preview, {
    ...(query.has("from") && Number.isSafeInteger(from) && from >= 0 && { from }),
    ...(log !== null && { log }),
  });
  return Response.json({ ...chunk, state: opened.preview.attemptState }, { headers: { "Cache-Control": "no-store" } });
}
