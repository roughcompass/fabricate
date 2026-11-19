import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { type FabricateConfig, getConfig, isInside } from "@/lib/config";
import { type Executor, getDb } from "@/lib/db/client";
import { openPreview } from "./access";
import { type ArtifactEntry, PAGE } from "./output";
import { rebaseHtmlStream } from "./rebase";
import { markOpened } from "./records";
import { previewDirectory, publishedDirectory } from "./storage";
import { previewBasePath } from "./toolchain";

/**
 * Serves a preview's published artifact under `/previews/<id>/` (design
 * decision 6, spec "Previews are served under a Fabricate path"), whatever
 * state its latest attempt is in, so a rebuild or a failed rebuild leaves the
 * last published output serving.
 *
 * Every request passes the same gate as the preview's page and log: previews
 * on, the preview undeleted with a published artifact, and its remote
 * enrolled. Anything else answers the same 404. Responses require
 * revalidation, so a browser never reuses a file without that gate running
 * again, and nothing sets `Service-Worker-Allowed`, so a preview's service
 * worker is scoped to its own folder.
 *
 * Paths resolve only to regular files inside the published directory: a
 * segment that is empty, `.` or `..`, or holds a slash, backslash, or NUL
 * answers 404, and so does a path that reaches a file through a symbolic
 * link. Files are streamed, never read whole.
 *
 * The root is `/previews/<id>/`, with its slash, and serves the artifact's
 * `index.html`; `/previews/<id>` redirects there. Every published artifact has
 * that page, a microfrontend's included (design decision 7), and navigation
 * to a path that names no file falls back to it; see isNavigation.
 */

const MAX_SEGMENTS = 64;
const MAX_SEGMENT_LENGTH = 255;

/** Content types by extension; anything else is application/octet-stream, which nosniff keeps from being run or rendered. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
};

/** The content type a file is served with, by its extension. */
export function contentType(file: string): string {
  return CONTENT_TYPES[path.posix.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Headers every response from the route carries. The answer for a missing path depends on the navigation headers, so caches key on them. */
const COMMON_HEADERS = { "X-Content-Type-Options": "nosniff", Vary: "Sec-Fetch-Dest, Accept" } as const;

/**
 * Whether a request for a missing path is a navigation, which falls back to
 * `index.html`: its last segment has no `.`, so it
 * doesn't name a file, and the browser wants a page. With `Sec-Fetch-Dest`
 * present, that's a `document`, `iframe`, or `frame` destination; without it,
 * an `Accept` header that lists `text/html`. A script, style, image, or
 * `fetch()` request, or any path with an extension, gets a 404 instead.
 */
export function isNavigation(request: Pick<Request, "headers">, segments: readonly string[]): boolean {
  if ((segments.at(-1) ?? "").includes(".")) return false;
  const destination = request.headers.get("sec-fetch-dest");
  if (destination !== null) return destination === "document" || destination === "iframe" || destination === "frame";
  return /(^|[\s,])text\/html\s*(;|,|$)/i.test(request.headers.get("accept") ?? "");
}

export interface ServeOptions {
  db?: Executor;
  config?: FabricateConfig;
  now?: Date;
}

/** Answers a GET or HEAD for +segments+ under the preview +publicId+'s path. */
export async function servePreview(request: Request, publicId: string, segments: readonly string[], options: ServeOptions = {}): Promise<Response> {
  const db = options.db ?? getDb();
  const config = options.config ?? getConfig();
  const head = request.method === "HEAD";
  const opened = openPreview(db, config, publicId);
  if (!opened) return notFound(head);
  const { preview } = opened;
  if (preview.artifact === null || preview.artifactEntry === null) return notFound(head);

  // A trailing slash adds an empty last segment; the path is the same.
  const parts = segments.at(-1) === "" ? segments.slice(0, -1) : segments;
  if (!safeSegments(parts)) return notFound(head);
  const base = previewBasePath(preview.publicId);
  const url = new URL(request.url);
  // The root ends in a slash, so the page's relative references, and a router based at the preview's path, resolve inside it.
  if (parts.length === 0 && !url.pathname.endsWith("/")) return redirect(`${base}${url.search}`);

  const root = await artifactRoot(config, preview);
  if (!root) return notFound(head);
  const entry = preview.artifactEntry as Partial<ArtifactEntry>;
  let served = parts.length === 0 ? PAGE : parts.join("/");
  let file = await regularFile(root, served);
  if (!file && isNavigation(request, parts)) {
    served = PAGE;
    file = await regularFile(root, served);
  }
  if (!file) return notFound(head);

  const page = served === PAGE;
  if (!head && page) markOpened(db, preview.publicId, options.now);
  return fileResponse(request, file, { type: contentType(served), tag: `${preview.artifact}:${served}`, rebase: page && entry.rebase === true ? base : null });
}

/** The published directory, resolved, when it's where the preview's row says, inside the preview's own directory. */
async function artifactRoot(config: FabricateConfig, preview: { publicId: string; artifact: string | null }): Promise<string | null> {
  try {
    const directory = publishedDirectory(config, preview);
    if (!directory) return null;
    const [own, real] = await Promise.all([fsp.realpath(previewDirectory(config, preview.publicId)), fsp.realpath(directory)]);
    return real === path.join(own, ...preview.artifact!.split("/")) ? real : null;
  } catch {
    return null;
  }
}

/** Whether every segment names an ordinary file or directory: nothing empty, `.` or `..`, and no slash, backslash, or NUL. */
function safeSegments(segments: readonly string[]): boolean {
  if (segments.length > MAX_SEGMENTS) return false;
  return segments.every((segment) => segment.length > 0 && segment.length <= MAX_SEGMENT_LENGTH && segment !== "." && segment !== ".." && !/[/\\\0]/.test(segment));
}

interface RegularFile {
  path: string;
  stat: fs.Stats;
}

/**
 * The regular file +relative+ names inside +root+, or null. A path whose
 * resolved location differs from the one asked for passed through a symbolic
 * link, or named the file in another case, and is refused.
 */
async function regularFile(root: string, relative: string): Promise<RegularFile | null> {
  const candidate = path.join(root, ...relative.split("/"));
  if (candidate === root || !isInside(root, candidate)) return null;
  try {
    const real = await fsp.realpath(candidate);
    if (real !== candidate) return null;
    const stat = await fsp.lstat(real);
    return stat.isFile() ? { path: real, stat } : null;
  } catch {
    return null;
  }
}

async function fileResponse(request: Request, file: RegularFile, options: { type: string; tag: string; rebase: string | null }): Promise<Response> {
  const etag = `"${crypto
    .createHash("sha256")
    .update(`${options.tag}:${file.stat.size}:${file.stat.mtimeMs}:${options.rebase ?? ""}`)
    .digest("base64url")
    .slice(0, 27)}"`;
  const headers = new Headers({ ...COMMON_HEADERS, "Content-Type": options.type, "Cache-Control": "private, no-cache", ETag: etag });
  if (matches(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  // No Content-Length: Next.js drops it from a route handler's response and sends the stream chunked.
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });

  // Opened without following a link, in case one replaced the file since it was checked.
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(file.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    if (!(await handle.stat()).isFile()) {
      await handle.close();
      return notFound(false);
    }
  } catch {
    return notFound(false);
  }
  const stream = Readable.toWeb(handle.createReadStream()) as unknown as ReadableStream<BufferSource>;
  const body = options.rebase ? stream.pipeThrough(new TextDecoderStream()).pipeThrough(rebaseHtmlStream(options.rebase)).pipeThrough(new TextEncoderStream()) : stream;
  return new Response(body, { status: 200, headers });
}

/** Whether an If-None-Match header lists +etag+, compared weakly. */
function matches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value.replace(/^W\//, "") === etag;
  });
}

function notFound(head: boolean): Response {
  return new Response(head ? null : "Not found\n", { status: 404, headers: { ...COMMON_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

function redirect(location: string): Response {
  // A relative Location keeps the browser on the host it used.
  return new Response(null, { status: 308, headers: { ...COMMON_HEADERS, Location: location, "Cache-Control": "no-store" } });
}
