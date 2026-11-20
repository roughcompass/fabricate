import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/previews/[preview]/log/route";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import { deletePreview } from "@/lib/previews/lifecycle";
import { LOG_TAIL_BYTES, cleanLog, logExcerpt, readLogChunk, readLogTail } from "@/lib/previews/log";
import { type PreviewBuild, claimAttempt, failAttempt, findPreview, rebuildPreview } from "@/lib/previews/records";
import { previewDirectory } from "@/lib/previews/storage";
import { buildRepository } from "../support/builders";
import { PLANTED } from "../support/credentials";
import { queuedPreview } from "../support/previews";
import { useAppDb } from "../support/next";

/*
 * A preview's latest attempt log, read by offset (design decision 9): the
 * tail first, then only what was written since, in whole lines, starting
 * over when the attempt, or the claim writing it, changes; and the endpoint
 * the preview page polls, behind the same gate as the page.
 */

describe("preview logs", () => {
  const original = getConfig();
  const app = useAppDb();
  let storage: string;
  let config: FrontendRegistryConfig;
  let repository: Repository;

  beforeEach(() => {
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preview-logs-")));
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

  /** +preview+'s current attempt, started by the claim +claim+, whose log holds +text+. */
  function building(preview: PreviewBuild, text: string, claim = "abc123"): PreviewBuild {
    const current = findPreview(app.db, preview.publicId)!;
    const name = `logs/${current.attempt}-${claim}.log`;
    fs.mkdirSync(path.join(previewDirectory(config, preview.publicId), "logs"), { recursive: true });
    fs.writeFileSync(path.join(previewDirectory(config, preview.publicId), name), text);
    return claimAttempt(app.db, preview.publicId, current.attempt, `worker#${claim}`, name)!;
  }

  const append = (preview: PreviewBuild, text: string) => fs.appendFileSync(path.join(previewDirectory(config, preview.publicId), preview.attemptLog!), text);

  describe("reading by offset", () => {
    it("reads the tail, then only the whole lines written since, and the last line once the attempt finishes", async () => {
      const preview = building(queuedPreview(app.db, repository), "==> extract: git archive\n==> install: npm ci in the repository root\nadded 2 pack");

      const tail = await readLogChunk(config, preview);
      expect(tail).toMatchObject({ attempt: 1, log: "1-abc123", start: 0, text: "==> extract: git archive\n==> install: npm ci in the repository root\n", truncated: false, reset: false, more: true });

      append(preview, "ages in 127ms\n==> build: npm run build\n");
      const next = await readLogChunk(config, preview, { from: tail.end, log: "1-abc123" });
      expect(next).toMatchObject({ start: tail.end, text: "added 2 packages in 127ms\n==> build: npm run build\n", reset: false, more: false });
      expect(await readLogChunk(config, preview, { from: next.end, log: "1-abc123" })).toMatchObject({ start: next.end, end: next.end, text: "" });

      append(preview, "==> failed: The build failed");
      failAttempt(app.db, preview.publicId, { attempt: 1 }, "The build failed");
      const finished = await readLogChunk(config, findPreview(app.db, preview.publicId)!, { from: next.end, log: "1-abc123" });
      expect(finished).toMatchObject({ text: "==> failed: The build failed", more: false });
    });

    it("starts over from the new log's tail when the offset belongs to an earlier attempt's or claim's log", async () => {
      const first = building(queuedPreview(app.db, repository), "==> install: npm ci\n".repeat(20));
      const read = await readLogChunk(config, first);
      failAttempt(app.db, first.publicId, { attempt: 1 }, "The build failed");

      const rebuilt = building(rebuildPreview(app.db, first.publicId), "==> extract: git archive\n", "def456");
      expect(await readLogChunk(config, rebuilt, { from: read.end, log: "1-abc123" })).toMatchObject({ attempt: 2, log: "2-def456", start: 0, text: "==> extract: git archive\n", reset: true });

      // Another worker took the same attempt over with a log of its own.
      const takenOver = building(rebuilt, "==> extract: git archive again\n", "fed789");
      expect(await readLogChunk(config, takenOver, { from: 25, log: "2-def456" })).toMatchObject({ log: "2-fed789", text: "==> extract: git archive again\n", reset: true });
      // An offset past the end can't belong to this log either.
      expect(await readLogChunk(config, takenOver, { from: 10_000, log: "2-fed789" })).toMatchObject({ start: 0, reset: true });
    });

    it("starts a long log's tail at a line, and reads a long remainder in chunks", async () => {
      const line = `${"x".repeat(99)}\n`;
      const preview = building(queuedPreview(app.db, repository), line.repeat(10_000));
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

    it("redacts every credential as it reads, so a log written before its build redacted its output shows none", async () => {
      const preview = building(queuedPreview(app.db, repository), `==> build: npm run build\n${PLANTED.map((planted) => planted.line).join("\n")}\n`);
      const tail = await readLogChunk(config, preview);
      for (const { secret } of PLANTED) expect(tail.text).not.toContain(secret);
      expect(tail.text.split("\n").filter((line) => line.includes("[REDACTED]"))).toHaveLength(PLANTED.length);
    });

    it("has no log before a worker starts the attempt", async () => {
      const preview = queuedPreview(app.db, repository);
      expect(await readLogChunk(config, preview)).toEqual({ attempt: 1, log: null, start: 0, end: 0, text: "", truncated: false, reset: false, more: false });
      expect((await readLogChunk(config, preview, { from: 40, log: "1-abc123" })).reset).toBe(true);
    });
  });

  it("shows terminal output as text: colors and cursor sequences removed, and a rewritten line as it ended", () => {
    expect(cleanLog("\u001b[32m✓\u001b[39m built in \u001b[1m12ms\u001b[22m\n")).toBe("✓ built in 12ms\n");
    expect(cleanLog("progress 10%\rprogress 50%\rprogress 100%\r\nnext line\r\n")).toBe("progress 100%\nnext line\n");
    expect(cleanLog("\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007\n")).toBe("link\n");
  });

  describe("a failed build's excerpt", () => {
    const STAGING = "/srv/previews/pvw_x/staging/1-abc123";
    const WORK = `${STAGING}/work`;
    const log = (output: string[]) =>
      [
        "==> extract: git archive 0123",
        "==> install: yarn install --frozen-lockfile in the repository root, with yarn.lock",
        "[1/4] Resolving packages...",
        "warning An unexpected error-looking warning during install",
        "==> build: corepack yarn@1.22.22 run build --base=/previews/pvw_x/ in the repository root",
        ...output,
        "==> failed: The build failed: corepack yarn@1.22.22 run build exited with code 1.",
        "",
      ].join("\n");

    it("shows the failing step's error, without stack frames, pointers to other logs, or the build's own directories (fleet/mf-billing)", () => {
      const vite = [
        "yarn run v1.22.22",
        "$ vite build --base=/previews/pvw_x/",
        "\u001b[36mvite v5.4.21 \u001b[32mbuilding for production...\u001b[39m",
        "transforming...",
        "✓ 3 modules transformed.",
        "x Build failed in 64ms",
        "error during build:",
        'Could not resolve "./totals" from "src/Billing.tsx"',
        `file: ${WORK}/src/Billing.tsx`,
        `    at error (file://${WORK}/node_modules/rollup/dist/es/shared/parseAst.js:315:42)`,
        "    at Object.error (file:///x.js:1:1)",
        "error Command failed with exit code 1.",
        "info Visit https://yarnpkg.com/en/docs/cli/run for documentation about this command.",
      ];
      expect(logExcerpt(log(vite), { strip: [WORK, STAGING] })).toEqual([
        "vite v5.4.21 building for production...",
        "transforming...",
        "✓ 3 modules transformed.",
        "x Build failed in 64ms",
        "error during build:",
        'Could not resolve "./totals" from "src/Billing.tsx"',
        "file: src/Billing.tsx",
        "error Command failed with exit code 1.",
      ]);
    });

    it("starts at the first problem a long output names, and leaves out npm's restatement of the command", () => {
      const errors = Array.from({ length: 40 }, (_, index) => `src/file${index}.ts(1,1): error TS2304: Cannot find name 'x${index}'.`);
      const excerpt = logExcerpt(log(["> tsc --noEmit && vite build", ...errors, "npm error Lifecycle script `build` failed with error:", "npm error code 2", `npm error path ${WORK}`, "npm error command failed"]));
      expect(excerpt).toHaveLength(8);
      expect(excerpt[0]).toBe("> tsc --noEmit && vite build");
      expect(excerpt[1]).toBe("src/file0.ts(1,1): error TS2304: Cannot find name 'x0'.");
      expect(excerpt.join("\n")).not.toContain("npm error code");
    });

    it("shows the last lines when none names a problem, caps each line, and is empty when the step wrote nothing", () => {
      const lines = Array.from({ length: 12 }, (_, index) => `step ${index}`);
      expect(logExcerpt(log(lines))).toEqual(lines.slice(-8));
      expect(logExcerpt(log([`error ${"x".repeat(400)}`]))[0]).toHaveLength(240);
      expect(logExcerpt(log([]))).toEqual([]);
      // A build that stopped before its first step wrote anything.
      expect(logExcerpt("==> extract: git archive 0123\n==> failed: The commit couldn't be extracted\n")).toEqual([]);
    });

    it("redacts what looks like a credential, as failure reasons are", () => {
      const excerpt = logExcerpt(log(["error fetching https://deploy:hunter2@git.example.com/acme/lib.git", "error 401 with token=abc123def and ghp_0123456789abcdefABCDEF"]));
      expect(excerpt.join("\n")).not.toMatch(/hunter2|abc123def|ghp_0123456789abcdefABCDEF/);
      expect(excerpt[0]).toBe("error fetching https://[REDACTED]@git.example.com/acme/lib.git");
    });

    it("reads a log's tail from a line's start", async () => {
      const file = path.join(storage, "tail.log");
      fs.writeFileSync(file, `${"x".repeat(LOG_TAIL_BYTES)}\nlast line\n`);
      expect(await readLogTail(file)).toBe("last line\n");
      expect(await readLogTail(path.join(storage, "missing.log"))).toBe("");
    });
  });

  describe("the log endpoint", () => {
    const get = async (publicId: string, query = "") => {
      const response = await GET(new Request(`http://localhost/api/previews/${publicId}/log${query}`), { params: Promise.resolve({ preview: publicId }) });
      return { status: response.status, cache: response.headers.get("cache-control"), body: (await response.json()) as Record<string, unknown> };
    };

    it("answers the attempt, its log, its state, and the lines after an offset", async () => {
      const preview = building(queuedPreview(app.db, repository), "==> extract: git archive\n");
      const first = await get(preview.publicId);
      expect(first).toMatchObject({ status: 200, cache: "no-store", body: { attempt: 1, log: "1-abc123", state: "building", start: 0, end: 25, text: "==> extract: git archive\n", reset: false } });

      append(preview, "==> install: npm ci\n");
      expect((await get(preview.publicId, "?from=25&log=1-abc123")).body).toMatchObject({ start: 25, text: "==> install: npm ci\n", reset: false });
      // A malformed offset reads the tail.
      expect((await get(preview.publicId, "?from=-4&log=1-abc123")).body).toMatchObject({ start: 0 });

      failAttempt(app.db, preview.publicId, { attempt: 1, claim: "worker#abc123" }, "The build failed");
      const rebuilt = building(rebuildPreview(app.db, preview.publicId), "==> extract: again\n", "def456");
      expect((await get(rebuilt.publicId, "?from=45&log=1-abc123")).body).toMatchObject({ attempt: 2, log: "2-def456", state: "building", start: 0, text: "==> extract: again\n", reset: true });
    });

    it("answers not found while previews are off, for a deleted preview, an unenrolled remote, or an unknown id", async () => {
      const preview = building(queuedPreview(app.db, repository), "==> extract: git archive\n");
      configure({ enabled: false });
      expect((await get(preview.publicId)).status).toBe(404);
      configure({ trustedSources: [] });
      expect((await get(preview.publicId)).status).toBe(404);
      configure({});
      expect((await get("pvw_0000000000000000")).status).toBe(404);
      expect((await get("not-an-id")).status).toBe(404);
      await deletePreview(app.db, preview.publicId, config);
      expect((await get(preview.publicId)).status).toBe(404);
    });
  });
});
