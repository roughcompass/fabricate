import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editRepository } from "@/lib/repositories/registration";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import { contentType, isNavigation, servePreview } from "@/lib/previews/serving";
import { type PreviewBuild, failAttempt, findPreview, rebuildPreview } from "@/lib/previews/records";
import { previewDirectory } from "@/lib/previews/storage";
import { buildRepository } from "../support/builders";
import { rawRun } from "../support/db";
import { publishFiles, queuedPreview } from "../support/previews";
import { useAppDb } from "../support/next";

/*
 * Serving a preview's published artifact under /previews/<id>/ (design
 * decision 6, spec "Previews are served under a Frontend Registry path"), through the
 * route handler itself.
 */

const PAGE = '<!doctype html><html><head><script type="module" src="/previews/{{id}}/assets/app.js"></script></head><body><div id="root"></div></body></html>\n';
const STANDALONE = {
  "assets/app.js": "document.getElementById('root').textContent = 'Orders';\n",
  "assets/app.css": "#root{color:red}\n",
  "assets/logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
  "assets/inter.woff2": Buffer.from([0x77, 0x4f, 0x46, 0x32]),
  "assets/data.bin": Buffer.from([0, 1, 2, 3]),
  "about.html": '<a href="/about">about</a>',
};

describe("serving previews", () => {
  const original = getConfig();
  const app = useAppDb();
  let storage: string;
  let config: FrontendRegistryConfig;
  let repository: Repository;

  beforeEach(() => {
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preview-serving-")));
    repository = buildRepository(app.db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git" });
    configure({});
  });

  afterEach(() => {
    setConfig(original);
    fs.rmSync(storage, { recursive: true, force: true });
  });

  function configure(previews: Partial<FrontendRegistryConfig["settings"]["previews"]>): void {
    config = withOverrides(original, { previews: { enabled: true, trustedSources: [repository.canonicalUrl], storage, ...previews } });
    setConfig(config);
  }

  /** A Ready standalone preview whose page refers to its assets under its own path. */
  function standalone(files: Record<string, string | Buffer> = STANDALONE, entry = {}): PreviewBuild {
    const preview = queuedPreview(app.db, repository);
    return publishFiles(app.db, config, preview, { "index.html": PAGE.replace("{{id}}", preview.publicId), ...files }, entry);
  }

  /** The route's answer to a request for +url+, with +headers+. */
  async function get(url: string, headers: Record<string, string> = {}, method = "GET"): Promise<Response> {
    const route = await import("@/app/previews/[preview]/[[...path]]/route");
    const [, , preview, ...rest] = new URL(url, "http://localhost").pathname.split("/");
    const request = new Request(new URL(url, "http://localhost"), { method, headers });
    const params = Promise.resolve({ preview: decodeURIComponent(preview!), path: rest.length ? rest.map((segment) => decodeURIComponent(segment)) : undefined });
    return method === "HEAD" ? route.HEAD(request, { params }) : route.GET(request, { params });
  }
  /** The route's answer for raw path segments, as Next.js passes them decoded. */
  async function segments(preview: PreviewBuild, parts: string[]): Promise<Response> {
    const route = await import("@/app/previews/[preview]/[[...path]]/route");
    return route.GET(new Request(`http://localhost/previews/${preview.publicId}/x`, { headers: { "sec-fetch-dest": "document" } }), { params: Promise.resolve({ preview: preview.publicId, path: parts }) });
  }
  const page = { "sec-fetch-dest": "document", accept: "text/html,application/xhtml+xml" };
  const base = (preview: PreviewBuild) => `/previews/${preview.publicId}/`;

  describe("files", () => {
    it("serves the page at the preview's root, streamed, with revalidation, nosniff, and no service worker scope or cookie", async () => {
      const preview = standalone();
      const response = await get(base(preview), page);

      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(ReadableStream);
      expect(await response.text()).toBe(PAGE.replace("{{id}}", preview.publicId));
      expect(Object.fromEntries(response.headers)).toMatchObject({
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-cache",
        "x-content-type-options": "nosniff",
        etag: expect.stringMatching(/^"[\w-]+"$/),
      });
      expect(response.headers.has("service-worker-allowed")).toBe(false);
      expect(response.headers.has("set-cookie")).toBe(false);
    });

    it("serves the root with its slash, without redirecting", async () => {
      const preview = standalone();
      const response = await get(`${base(preview)}?device=mobile`, page);
      expect(response.status).toBe(200);
      expect(response.headers.has("location")).toBe(false);
      expect(await response.text()).toBe(PAGE.replace("{{id}}", preview.publicId));
    });

    it("redirects the root without its slash to the root with it, keeping the query, so relative references and a router based at the preview's path resolve", async () => {
      const preview = standalone();
      for (const method of ["GET", "HEAD"]) {
        const response = await get(`/previews/${preview.publicId}?device=mobile`, page, method);
        expect(response.status).toBe(308);
        expect(response.headers.get("location")).toBe(`${base(preview)}?device=mobile`);
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
      // Only a preview that would be served is redirected.
      configure({ enabled: false });
      expect((await get(`/previews/${preview.publicId}`, page)).status).toBe(404);
    });

    it.each([
      ["assets/app.js", "text/javascript; charset=utf-8"],
      ["assets/app.css", "text/css; charset=utf-8"],
      ["assets/logo.svg", "image/svg+xml"],
      ["assets/inter.woff2", "font/woff2"],
      ["assets/data.bin", "application/octet-stream"],
      ["about.html", "text/html; charset=utf-8"],
    ])("serves %s as %s", async (file, type) => {
      const preview = standalone();
      const response = await get(`${base(preview)}${file}`, { "sec-fetch-dest": "script" });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(type);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(STANDALONE[file as keyof typeof STANDALONE]))).toBe(true);
    });

    it("answers HEAD with the headers and no body", async () => {
      const preview = standalone();
      const response = await get(`${base(preview)}assets/app.js`, {}, "HEAD");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(response.body).toBeNull();
    });

    it("streams a large file whole", async () => {
      const large = Buffer.alloc(6 * 1024 * 1024, "a");
      const preview = standalone({ "assets/vendor.js": large });
      const response = await get(`${base(preview)}assets/vendor.js`);
      expect(response.body).toBeInstanceOf(ReadableStream);
      expect(Buffer.from(await response.arrayBuffer()).equals(large)).toBe(true);
    });

    it("answers a request whose copy is current with 304, still checking the preview first", async () => {
      const preview = standalone();
      const etag = (await get(`${base(preview)}assets/app.js`)).headers.get("etag")!;
      const revalidated = await get(`${base(preview)}assets/app.js`, { "if-none-match": `W/${etag}` });
      expect(revalidated.status).toBe(304);
      expect(revalidated.body).toBeNull();
      expect(revalidated.headers.get("cache-control")).toBe("private, no-cache");

      configure({ enabled: false });
      expect((await get(`${base(preview)}assets/app.js`, { "if-none-match": etag })).status).toBe(404);
    });

    it.each([
      ["md", "text/markdown; charset=utf-8"],
      ["MJS", "text/javascript; charset=utf-8"],
      ["wasm", "application/wasm"],
      ["webmanifest", "application/manifest+json; charset=utf-8"],
      ["unknown", "application/octet-stream"],
    ])("types .%s as %s", (extension, type) => {
      expect(contentType(`dir/file.${extension}`)).toBe(type);
    });
  });

  describe("navigation", () => {
    it.each([
      ["a document", { "sec-fetch-dest": "document" }],
      ["a frame, like the device frame", { "sec-fetch-dest": "iframe" }],
      ["a page, by its Accept header when Sec-Fetch-Dest is absent", { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" }],
    ])("falls back to index.html for a client-side route requested as %s", async (_label, headers) => {
      const preview = standalone();
      const response = await get(`${base(preview)}accounts/42`, headers);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response.text()).toBe(PAGE.replace("{{id}}", preview.publicId));
      // A route with a trailing slash too.
      expect((await get(`${base(preview)}accounts/42/`, headers)).status).toBe(200);
    });

    it.each([
      ["a missing asset requested as a document", "assets/missing.js", page],
      ["a missing asset requested by a script", "assets/missing.js", { "sec-fetch-dest": "script" }],
      ["a route requested by fetch()", "api/accounts", { "sec-fetch-dest": "empty", accept: "text/html" }],
      ["a route requested as an image", "accounts/42", { "sec-fetch-dest": "image" }],
      ["a route requested without asking for a page", "accounts/42", { accept: "*/*" }],
      ["a dotted route", "users/jane.doe", page],
    ])("answers 404 for %s", async (_label, file, headers) => {
      const preview = standalone();
      const response = await get(`${base(preview)}${file}`, headers);
      expect(response.status).toBe(404);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("decides navigation from the last segment and the request's destination", () => {
      const request = (headers: Record<string, string>) => ({ headers: new Headers(headers) });
      expect(isNavigation(request({ "sec-fetch-dest": "frame" }), ["a"])).toBe(true);
      expect(isNavigation(request({ "sec-fetch-dest": "document" }), [])).toBe(true);
      expect(isNavigation(request({ "sec-fetch-dest": "document" }), ["v1.2"])).toBe(false);
      expect(isNavigation(request({ "sec-fetch-dest": "worker", accept: "text/html" }), ["a"])).toBe(false);
      expect(isNavigation(request({ accept: "application/json" }), ["a"])).toBe(false);
      expect(isNavigation(request({ accept: "application/xhtml+xml, text/html;q=0.9" }), ["a"])).toBe(true);
      expect(isNavigation(request({}), ["a"])).toBe(false);
    });

    it("serves a microfrontend's own page at its root and for navigation, like any other application", async () => {
      const preview = queuedPreview(app.db, repository, "module_federation");
      publishFiles(app.db, config, preview, { "index.html": "<!doctype html><title>admin</title>", "remoteEntry.js": "var mfAdmin;\n" });

      expect(await (await get(base(preview), page)).text()).toContain("<title>admin</title>");
      expect((await get(`${base(preview)}remoteEntry.js`)).status).toBe(200);
      expect(await (await get(`${base(preview)}settings`, page)).text()).toContain("<title>admin</title>");
      expect((await get(`${base(preview)}missing.js`, { "sec-fetch-dest": "script" })).status).toBe(404);
    });

    it("serves __host like any other path", async () => {
      const preview = standalone({ ...STANDALONE, "__host/app.js": "artifact script" });
      expect(await (await get(`${base(preview)}__host/app.js`)).text()).toBe("artifact script");
      for (const file of ["__host", "__host/", "__host/accounts"]) expect(await (await get(`${base(preview)}${file}`, page)).text(), file).toBe(PAGE.replace("{{id}}", preview.publicId));
      expect((await get(`${base(preview)}__host/react.production.min.js`)).status).toBe(404);
    });
  });

  describe("boundaries", () => {
    it.each([
      [[".."]],
      [["..", "logs", "1-test.log"]],
      [["..", "..", "secret.txt"]],
      [["..", "..", "..", "..", "..", "..", "..", "etc", "passwd"]],
      [["assets", "..", "..", "logs", "1-test.log"]],
      [["../logs/1-test.log"]],
      [["..\\logs\\1-test.log"]],
      [["/etc/passwd"]],
      [["assets", "", "app.js"]],
      [["."]],
      [["index.html\0.js"]],
      [["%2e%2e", "logs", "1-test.log"]],
      [Array.from({ length: 65 }, () => "a")],
    ])("answers 404 for the segments %j, which would leave the output or aren't plain names", async (parts) => {
      const preview = standalone();
      fs.mkdirSync(path.join(previewDirectory(config, preview.publicId), "logs"), { recursive: true });
      fs.writeFileSync(path.join(previewDirectory(config, preview.publicId), "logs", "1-test.log"), "log");
      fs.writeFileSync(path.join(storage, "secret.txt"), "secret");
      const response = await segments(preview, parts);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found\n");
    });

    it("never follows a symbolic link, to a file or directory outside the output or inside it", async () => {
      const preview = standalone();
      const root = path.join(previewDirectory(config, preview.publicId), "out", "1-test");
      fs.writeFileSync(path.join(storage, "secret.txt"), "secret");
      fs.mkdirSync(path.join(storage, "elsewhere"));
      fs.writeFileSync(path.join(storage, "elsewhere", "file.js"), "secret");
      fs.symlinkSync(path.join(storage, "secret.txt"), path.join(root, "secret.js"));
      fs.symlinkSync(path.join(storage, "elsewhere"), path.join(root, "linked"));
      fs.symlinkSync(path.join(root, "assets", "app.js"), path.join(root, "assets", "alias.js"));

      for (const file of ["secret.js", "linked/file.js", "assets/alias.js"]) expect((await get(`${base(preview)}${file}`)).status, file).toBe(404);
      // A symlink named like a route doesn't stop the fallback from serving the page instead.
      expect(await (await get(`${base(preview)}linked`, page)).text()).toContain('<div id="root">');
    });

    it("refuses an artifact directory that is itself a link out of the preview's directory", async () => {
      const preview = standalone();
      const root = path.join(previewDirectory(config, preview.publicId), "out", "1-test");
      const moved = path.join(storage, "moved");
      fs.renameSync(root, moved);
      fs.symlinkSync(moved, root);
      expect((await get(`${base(preview)}assets/app.js`)).status).toBe(404);
    });
  });

  describe("access", () => {
    it("serves the published artifact whatever the latest attempt's state, while a rebuild is queued and after it fails", async () => {
      const preview = standalone();
      rebuildPreview(app.db, preview.publicId);
      expect((await get(`${base(preview)}assets/app.js`)).status).toBe(200);
      failAttempt(app.db, preview.publicId, { attempt: 2 }, "vite build exited with code 1");
      expect(findPreview(app.db, preview.publicId)).toMatchObject({ attemptState: "failed", artifactAttempt: 1 });
      expect((await get(base(preview), page)).status).toBe(200);
    });

    it("answers 404 for an unknown or malformed preview, and for one with nothing published yet", async () => {
      const queued = queuedPreview(app.db, repository);
      for (const id of ["pvw_0000000000000000", "src_0000000000000000", "pvw_x", "..", queued.publicId]) expect((await get(`/previews/${id}/`, page)).status, id).toBe(404);
    });

    it("answers 404 while previews are off, keeps the files, and serves them again once previews are on", async () => {
      const preview = standalone();
      configure({ enabled: false });
      expect((await get(base(preview), page)).status).toBe(404);
      expect((await get(`${base(preview)}assets/app.js`)).status).toBe(404);
      expect(fs.existsSync(path.join(previewDirectory(config, preview.publicId), "out", "1-test", "index.html"))).toBe(true);

      configure({});
      expect((await get(base(preview), page)).status).toBe(200);
    });

    it("answers 404 once the remote isn't enrolled, by settings or because the Repository now names another remote", async () => {
      const preview = standalone();
      configure({ trustedSources: [] });
      expect((await get(`${base(preview)}assets/app.js`)).status).toBe(404);

      configure({});
      expect((await get(`${base(preview)}assets/app.js`)).status).toBe(200);
      editRepository(app.db, repository.publicId, repository.lockVersion, { name: "orders", cloneUrl: "https://git.example.com/acme/orders-fork.git", gitRef: "" });
      expect((await get(`${base(preview)}assets/app.js`)).status).toBe(404);
    });

    it("answers 404 for a deleted preview, and for every preview of a deleted Repository", async () => {
      const deleted = standalone();
      const other = standalone();
      rawRun(app.db, "update preview_builds set deleted_at = ? where public_id = ?", Date.now(), deleted.publicId);
      expect((await get(base(deleted), page)).status).toBe(404);
      expect((await get(base(other), page)).status).toBe(200);
      rawRun(app.db, "update repository_sources set deleted_at = ? where id = ?", Date.now(), repository.id);
      expect((await get(base(other), page)).status).toBe(404);
    });
  });

  describe("rebasing", () => {
    const ROOTED = '<!doctype html><html><head><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css"></head><body></body></html>';

    it("rewrites the page of an artifact recorded as needing it, wherever it's served from, and only that page", async () => {
      const preview = standalone({ ...STANDALONE, "index.html": ROOTED }, { rebase: true });
      expect(preview.artifactEntry).toMatchObject({ rebase: true });
      const expected = `<!doctype html><html><head><base href="${base(preview)}"><script type="module" src="${base(preview)}assets/app.js"></script><link rel="stylesheet" href="${base(preview)}assets/app.css"></head><body></body></html>`;

      for (const file of ["", "index.html", "accounts/42"]) {
        const response = await get(`${base(preview)}${file}`, page);
        expect(await response.text(), file).toBe(expected);
        expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      }
      expect(await (await get(`${base(preview)}about.html`, page)).text()).toBe(STANDALONE["about.html"]);
    });

    it("leaves the page of an artifact built with the base path as it is", async () => {
      const preview = standalone({ ...STANDALONE, "index.html": ROOTED }, { rebase: false });
      expect(await (await get(base(preview), page)).text()).toBe(ROOTED);
    });
  });

  describe("opening", () => {
    it("records when the artifact's page is opened, at most once a minute, and not for its assets or HEAD requests", async () => {
      const preview = standalone();
      const opened = () => findPreview(app.db, preview.publicId)!.lastOpenedAt;
      const request = (file: string, method = "GET") => new Request(`http://localhost${base(preview)}${file}`, { method, headers: page });
      const at = (ms: number) => ({ db: app.db, config, now: new Date(ms) });

      await servePreview(request("assets/app.js"), preview.publicId, ["assets", "app.js"], at(1_000_000));
      await servePreview(request("", "HEAD"), preview.publicId, [], at(1_000_000));
      expect(opened()).toBeNull();

      await servePreview(request(""), preview.publicId, [], at(1_000_000));
      expect(opened()).toEqual(new Date(1_000_000));
      await servePreview(request("accounts/42"), preview.publicId, ["accounts", "42"], at(1_030_000));
      expect(opened()).toEqual(new Date(1_000_000));
      await servePreview(request("accounts/42"), preview.publicId, ["accounts", "42"], at(1_061_000));
      expect(opened()).toEqual(new Date(1_061_000));
    });
  });
});
