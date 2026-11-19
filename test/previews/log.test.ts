import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/previews/[preview]/log/route";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { type FabricateConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import { type Db, setDb } from "@/lib/db/client";
import { deletePreview } from "@/lib/previews/lifecycle";
import { LOG_TAIL_BYTES, cleanLog, readLogChunk } from "@/lib/previews/log";
import { type PreviewBuild, claimAttempt, failAttempt, findPreview, rebuildPreview } from "@/lib/previews/records";
import { previewDirectory } from "@/lib/previews/storage";
import { buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { queuedPreview } from "../support/previews";

/*
 * A preview's latest attempt log, read by offset (design decision 9): the
 * tail first, then only what was written since, in whole lines, starting
 * over when the attempt, or the claim writing it, changes; and the endpoint
 * the preview page polls, behind the same gate as the page.
 */

describe("preview logs", () => {
  const original = getConfig();
  let db: Db;
  let storage: string;
  let config: FabricateConfig;
  let source: RepositorySource;

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preview-logs-")));
    source = buildSource(db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git" });
    configure({});
  });

  afterEach(() => {
    setDb(undefined);
    setConfig(original);
    fs.rmSync(storage, { recursive: true, force: true });
  });

  function configure(previews: Partial<FabricateConfig["settings"]["previews"]>): void {
    config = withOverrides(original, { previews: { enabled: true, trustedSources: [source.canonicalUrl], storage, ...previews } });
    setConfig(config);
  }

  /** +preview+'s current attempt, started by the claim +claim+, whose log holds +text+. */
  function building(preview: PreviewBuild, text: string, claim = "abc123"): PreviewBuild {
    const current = findPreview(db, preview.publicId)!;
    const name = `logs/${current.attempt}-${claim}.log`;
    fs.mkdirSync(path.join(previewDirectory(config, preview.publicId), "logs"), { recursive: true });
    fs.writeFileSync(path.join(previewDirectory(config, preview.publicId), name), text);
    return claimAttempt(db, preview.publicId, current.attempt, `worker#${claim}`, name)!;
  }

  const append = (preview: PreviewBuild, text: string) => fs.appendFileSync(path.join(previewDirectory(config, preview.publicId), preview.attemptLog!), text);

  describe("reading by offset", () => {
    it("reads the tail, then only the whole lines written since, and the last line once the attempt finishes", async () => {
      const preview = building(queuedPreview(db, source), "==> extract: git archive\n==> install: npm ci in the repository root\nadded 2 pack");

      const tail = await readLogChunk(config, preview);
      expect(tail).toMatchObject({ attempt: 1, log: "1-abc123", start: 0, text: "==> extract: git archive\n==> install: npm ci in the repository root\n", truncated: false, reset: false, more: true });

      append(preview, "ages in 127ms\n==> build: npm run build\n");
      const next = await readLogChunk(config, preview, { from: tail.end, log: "1-abc123" });
      expect(next).toMatchObject({ start: tail.end, text: "added 2 packages in 127ms\n==> build: npm run build\n", reset: false, more: false });
      expect(await readLogChunk(config, preview, { from: next.end, log: "1-abc123" })).toMatchObject({ start: next.end, end: next.end, text: "" });

      append(preview, "==> failed: The build failed");
      failAttempt(db, preview.publicId, { attempt: 1 }, "The build failed");
      const finished = await readLogChunk(config, findPreview(db, preview.publicId)!, { from: next.end, log: "1-abc123" });
      expect(finished).toMatchObject({ text: "==> failed: The build failed", more: false });
    });

    it("starts over from the new log's tail when the offset belongs to an earlier attempt's or claim's log", async () => {
      const first = building(queuedPreview(db, source), "==> install: npm ci\n".repeat(20));
      const read = await readLogChunk(config, first);
      failAttempt(db, first.publicId, { attempt: 1 }, "The build failed");

      const rebuilt = building(rebuildPreview(db, first.publicId), "==> extract: git archive\n", "def456");
      expect(await readLogChunk(config, rebuilt, { from: read.end, log: "1-abc123" })).toMatchObject({ attempt: 2, log: "2-def456", start: 0, text: "==> extract: git archive\n", reset: true });

      // Another worker took the same attempt over with a log of its own.
      const takenOver = building(rebuilt, "==> extract: git archive again\n", "fed789");
      expect(await readLogChunk(config, takenOver, { from: 25, log: "2-def456" })).toMatchObject({ log: "2-fed789", text: "==> extract: git archive again\n", reset: true });
      // An offset past the end can't belong to this log either.
      expect(await readLogChunk(config, takenOver, { from: 10_000, log: "2-fed789" })).toMatchObject({ start: 0, reset: true });
    });

    it("starts a long log's tail at a line, and reads a long remainder in chunks", async () => {
      const line = `${"x".repeat(99)}\n`;
      const preview = building(queuedPreview(db, source), line.repeat(10_000));
      const size = line.length * 10_000;

      const tail = await readLogChunk(config, preview);
      expect(tail.truncated).toBe(true);
      expect(tail.end).toBe(size);
      expect(tail.start % line.length).toBe(0);
      expect(tail.text.length).toBeLessThanOrEqual(LOG_TAIL_BYTES);

      const first = await readLogChunk(config, preview, { from: 0, log: tail.log! });
      expect(first.more).toBe(true);
      expect(first.end % line.length).toBe(0);
      let end = first.end;
      while (end < size) end = (await readLogChunk(config, preview, { from: end, log: tail.log! })).end;
      expect(end).toBe(size);
    });

    it("has no log before a worker starts the attempt", async () => {
      const preview = queuedPreview(db, source);
      expect(await readLogChunk(config, preview)).toEqual({ attempt: 1, log: null, start: 0, end: 0, text: "", truncated: false, reset: false, more: false });
      expect((await readLogChunk(config, preview, { from: 40, log: "1-abc123" })).reset).toBe(true);
    });
  });

  it("shows terminal output as text: colors and cursor sequences removed, and a rewritten line as it ended", () => {
    expect(cleanLog("\u001b[32m✓\u001b[39m built in \u001b[1m12ms\u001b[22m\n")).toBe("✓ built in 12ms\n");
    expect(cleanLog("progress 10%\rprogress 50%\rprogress 100%\r\nnext line\r\n")).toBe("progress 100%\nnext line\n");
    expect(cleanLog("\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007\n")).toBe("link\n");
  });

  describe("the log endpoint", () => {
    const get = async (publicId: string, query = "") => {
      const response = await GET(new Request(`http://localhost/api/previews/${publicId}/log${query}`), { params: Promise.resolve({ preview: publicId }) });
      return { status: response.status, cache: response.headers.get("cache-control"), body: (await response.json()) as Record<string, unknown> };
    };

    it("answers the attempt, its log, its state, and the lines after an offset", async () => {
      const preview = building(queuedPreview(db, source), "==> extract: git archive\n");
      const first = await get(preview.publicId);
      expect(first).toMatchObject({ status: 200, cache: "no-store", body: { attempt: 1, log: "1-abc123", state: "building", start: 0, end: 25, text: "==> extract: git archive\n", reset: false } });

      append(preview, "==> install: npm ci\n");
      expect((await get(preview.publicId, "?from=25&log=1-abc123")).body).toMatchObject({ start: 25, text: "==> install: npm ci\n", reset: false });
      // A malformed offset reads the tail.
      expect((await get(preview.publicId, "?from=-4&log=1-abc123")).body).toMatchObject({ start: 0 });

      failAttempt(db, preview.publicId, { attempt: 1, claim: "worker#abc123" }, "The build failed");
      const rebuilt = building(rebuildPreview(db, preview.publicId), "==> extract: again\n", "def456");
      expect((await get(rebuilt.publicId, "?from=45&log=1-abc123")).body).toMatchObject({ attempt: 2, log: "2-def456", state: "building", start: 0, text: "==> extract: again\n", reset: true });
    });

    it("answers not found while previews are off, for a deleted preview, an unenrolled remote, or an unknown id", async () => {
      const preview = building(queuedPreview(db, source), "==> extract: git archive\n");
      configure({ enabled: false });
      expect((await get(preview.publicId)).status).toBe(404);
      configure({ trustedSources: [] });
      expect((await get(preview.publicId)).status).toBe(404);
      configure({});
      expect((await get("pvw_0000000000000000")).status).toBe(404);
      expect((await get("not-an-id")).status).toBe(404);
      await deletePreview(db, preview.publicId, config);
      expect((await get(preview.publicId)).status).toBe(404);
    });
  });
});
