import { getDb } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { mockApplication } from "@/lib/mocks/api";
import { HAR_UPLOAD_LIMIT, HarFormatError } from "@/lib/mocks/har-import";
import { createDraft } from "@/lib/mocks/imports";
import { NAME_LIMIT } from "@/lib/mocks/model";
import type { UploadError } from "@/lib/mocks/upload";
import { routes } from "@/lib/web/routes";
import { fromOwnOrigin } from "@/lib/workspaces/api";
import { writableWorkspace } from "@/lib/workspaces/request";

/*
 * Upload HAR (add-mock-sets, design decision 12, step 1, task 4.4): the
 * upload page's multipart form, which works without JavaScript. It refuses a
 * body over 50 MB, with the form's room, before reading it, and counts bytes
 * as it reads. It requires the confirmation that the recording holds only
 * synthetic test data, then reads, sanitizes, and groups the file into a
 * draft, and answers 303 to its review. At most two uploads are read at once
 * in a web process; a third is refused, saying to try again in a minute. The
 * upload is only ever in memory, so nothing of it is left whatever happens.
 * A refusal answers 303 back to the upload page, which says why.
 */

/** The form's own fields beside the file. */
const FORM_ROOM = 1024 * 1024;
const PARSE_LIMIT = 2;
let parsing = 0;

/** The request's body, or null once it passes +limit+ bytes, when reading stops. */
async function bodyWithin(request: Request, limit: number): Promise<Buffer | null> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

export async function POST(request: Request, ctx: RouteContext<"/api/applications/[slug]/mock-sets/imports">) {
  const application = mockApplication((await ctx.params).slug);
  if (application instanceof Response) return application;
  if (!fromOwnOrigin(request)) return Response.json({ error: "Uploads come only from the Frontend Registry's own pages" }, { status: 403 });
  const back = (error: UploadError, values: { set?: string; name?: string; from?: string } = {}) =>
    new Response(null, { status: 303, headers: { Location: routes.mockSetUpload(application.slug, { error, set: values.set ?? null, name: values.name ?? null, from: values.from ?? null }), "Cache-Control": "no-store" } });

  if (Number(request.headers.get("content-length") ?? 0) > HAR_UPLOAD_LIMIT + FORM_ROOM) return back("too-large");
  if (parsing >= PARSE_LIMIT) return back("busy");
  parsing++;
  try {
    const bytes = await bodyWithin(request, HAR_UPLOAD_LIMIT + FORM_ROOM);
    if (!bytes) return back("too-large");
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    } catch {
      return back("file");
    }
    const target = field(form, "target");
    const values = { set: target && target !== "new" ? target : undefined, name: field(form, "name").slice(0, 200), from: field(form, "from") === "onboarding" ? "onboarding" : undefined };
    if (field(form, "confirm") !== "yes") return back("confirm", values);
    const file = form.get("file");
    if (!(file instanceof Blob) || file.size === 0) return back("file", values);
    if (file.size > HAR_UPLOAD_LIMIT) return back("too-large", values);
    const name = values.name.trim();
    if (!values.set && !name) return back("name", values);
    if (!values.set && name.length > NAME_LIMIT) return back("name-length", values);
    const workspace = await writableWorkspace();
    try {
      const draft = createDraft(getDb(), { applicationId: application.id, workspaceId: workspace.id, fileName: file instanceof File ? file.name : "upload.har", target: values.set ?? null, setName: values.set ? null : name, fromOnboarding: values.from === "onboarding" }, await file.text());
      return new Response(null, { status: 303, headers: { Location: routes.mockSetImport(application.slug, draft.publicId), "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof HarFormatError) return back("not-har", values);
      if (error instanceof NotFoundError) return back("set-gone", { ...values, set: undefined });
      throw error;
    }
  } finally {
    parsing--;
  }
}
