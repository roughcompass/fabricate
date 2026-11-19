import http from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { type ServeOptions, servePreview } from "./serving";

/**
 * An in-process static server for published previews (add-applications,
 * design decision 4): the worker opens a build in a headless browser
 * through it, on 127.0.0.1 at an ephemeral port, without reaching the web
 * server. It answers `/previews/<id>/…` exactly as the web server's route
 * does, through the same serving module, servePreview, with its checks,
 * fallbacks, and headers, so a screenshot shows what a visitor would see.
 * Every other path answers 404.
 */

export interface PreviewServer {
  /** http://127.0.0.1:<port>, with no trailing slash. */
  readonly origin: string;
  close(): Promise<void>;
}

/** Starts the server; close it when done. */
export async function startPreviewServer(options: ServeOptions = {}): Promise<PreviewServer> {
  const server = http.createServer((request, response) => void answer(request, response, options));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A preview path's id and segments, decoded one by one as the web server's router decodes them; null for any other path. */
export function previewRoute(pathname: string): { preview: string; segments: string[] } | null {
  const match = /^\/previews\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (!match) return null;
  try {
    const rest = match[2];
    return { preview: decodeURIComponent(match[1]!), segments: rest === undefined || rest === "" ? [] : rest.split("/").map((segment) => decodeURIComponent(segment)) };
  } catch {
    return null;
  }
}

async function answer(request: http.IncomingMessage, response: http.ServerResponse, options: ServeOptions): Promise<void> {
  try {
    // The path as sent: a URL parser would resolve `.` and `..` segments that serving must refuse.
    const raw = request.url ?? "/";
    const route = previewRoute(raw.split("?")[0]!);
    const url = new URL(raw, "http://127.0.0.1");
    const method = request.method ?? "GET";
    if (!route || (method !== "GET" && method !== "HEAD")) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end(method === "HEAD" ? undefined : "Not found\n");
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const served = await servePreview(new Request(url, { method, headers }), route.preview, route.segments, options);
    response.writeHead(served.status, Object.fromEntries(served.headers));
    if (served.body && method !== "HEAD") await pipeline(Readable.fromWeb(served.body as NodeReadableStream), response);
    else response.end();
  } catch {
    if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end();
  }
}
