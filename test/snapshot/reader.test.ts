import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openSnapshot } from "@/lib/snapshot/open";
import type { Budgets } from "@/lib/snapshot/reader";
import { acquire, registerLocalSource, useAcquisitionWorld } from "../support/acquisition";
import { type Repo } from "../support/git-fixture";

const GENEROUS: Budgets = { maxBlobBytes: 1_048_576, maxLockfileBytes: 1_048_576, maxFiles: 1_000, maxTotalBytes: 10_485_760 };

describe("SnapshotReader", () => {
  const world = useAcquisitionWorld("reader");
  let work: Repo;

  beforeEach(() => {
    work = world.fixture.repo("fleet/orders");
  });

  /** Commits the work repository (unless already committed) and opens a reader on a fresh snapshot of it. */
  const snapshotReader = async (budgets = GENEROUS, options: { committed?: boolean } = {}) => {
    if (!options.committed) work.commit();
    const source = registerLocalSource(world.db, world.config, "orders", work.path);
    const { target, snapshot } = await acquire(world.db, world.config, source);
    return openSnapshot(target, snapshot, { config: world.config, budgets });
  };

  describe("tree enumeration and reads", () => {
    it("lists entries in stable code-unit order with modes, types, sizes, and object ids", async () => {
      work.write("b.txt", "b\n").write("a.txt", "a\n").write("Z.txt", "Z\n").write("src/deep/nested/file.ts", "export {};\n").write("bin/run", "#!/bin/sh\n", { executable: true });
      const reader = await snapshotReader();

      expect(reader.entries.map((entry) => [entry.path, entry.type])).toEqual([
        ["Z.txt", "file"],
        ["a.txt", "file"],
        ["b.txt", "file"],
        ["bin", "tree"],
        ["bin/run", "executable"],
        ["src", "tree"],
        ["src/deep", "tree"],
        ["src/deep/nested", "tree"],
        ["src/deep/nested/file.ts", "file"],
      ]);
      expect(reader.entry("bin/run")).toMatchObject({ mode: "100755", size: 10, objectId: expect.stringMatching(/^[0-9a-f]{40}$/) });
      expect(reader.files().map((entry) => entry.path)).toEqual(["Z.txt", "a.txt", "b.txt", "bin/run", "src/deep/nested/file.ts"]);
    });

    it("reads ordinary, nested, empty, and Unicode files in one batch", async () => {
      work.write("README.md", "hello\n").write("src/deep/nested/file.ts", "export const x = 1;\n").write("empty", "").write("docs/ünïcödé ✓.md", "Grüße, 世界 🌍\n");
      const reader = await snapshotReader();

      const reads = await reader.readMany(["src/deep/nested/file.ts", "README.md", "empty", "docs/ünïcödé ✓.md"]);
      const text = (file: string) => {
        const result = reads.get(file)!;
        return result.ok ? result.content.text : null;
      };
      expect(text("README.md")).toBe("hello\n");
      expect(text("src/deep/nested/file.ts")).toBe("export const x = 1;\n");
      expect(text("empty")).toBe("");
      expect(text("docs/ünïcödé ✓.md")).toBe("Grüße, 世界 🌍\n");
      const readme = reads.get("README.md")!;
      expect(readme.ok && readme.content.digest).toBe("5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03");
      expect(reader.usage()).toEqual({ files: 4, bytes: 6 + 20 + 0 + Buffer.byteLength("Grüße, 世界 🌍\n") });
    });

    it("returns a cached result for a repeated read without spending budget again", async () => {
      work.write("a.txt", "a\n");
      const reader = await snapshotReader();

      await reader.read("a.txt");
      await reader.read("a.txt");
      expect(reader.usage()).toEqual({ files: 1, bytes: 2 });
    });

    it("refuses to open a ref that no longer names the recorded commit", async () => {
      work.write("a.txt", "a\n").commit();
      const source = registerLocalSource(world.db, world.config, "orders", work.path);
      const { target, snapshot } = await acquire(world.db, world.config, source);

      await expect(openSnapshot(target, { ...snapshot, commitSha: "0".repeat(40) }, { config: world.config })).rejects.toMatchObject({ code: "command_rejected" });
      await expect(openSnapshot(target, { ...snapshot, internalRef: "refs/heads/main" }, { config: world.config })).rejects.toMatchObject({ code: "command_rejected" });
    });
  });

  describe("hostile trees", () => {
    it("records symbolic links and submodules as metadata without reading their targets", async () => {
      const outside = path.join(world.fixture.root, "outside-secret.txt");
      fs.writeFileSync(outside, "outside secret\n");
      work.write("README.md", "hello\n").symlink("escape", outside).symlink("parent", "../../../../etc/passwd");
      work.git("add", "--all");
      work.addGitlink("vendor/sub", "1111111111111111111111111111111111111111");
      work.git("commit", "--quiet", "-m", "gitlink");
      const reader = await snapshotReader(GENEROUS, { committed: true });

      expect(reader.entry("escape")).toMatchObject({ type: "symlink", mode: "120000" });
      expect(reader.entry("vendor/sub")).toMatchObject({ type: "gitlink", mode: "160000", objectId: "1111111111111111111111111111111111111111", size: null });
      expect(await reader.read("escape")).toMatchObject({ ok: false, skip: { reason: "symlink" } });
      expect(await reader.read("vendor/sub")).toMatchObject({ ok: false, skip: { reason: "gitlink" } });
      expect(await reader.linkTarget("escape")).toBe(outside);
      expect(await reader.linkTarget("parent")).toBe("../../../../etc/passwd");
      expect(await reader.read(".gitmodules")).toMatchObject({ ok: true });
    });

    it("never reads paths shaped like traversal, .git internals, or the protected fleet-kit tree", async () => {
      work.write("fleet-kit/answers.json", '{"answer":42}\n').write("nested/fleet-kit/more.json", "{}\n").write("README.md", "hello\n");
      const reader = await snapshotReader();

      expect(reader.entries.map((entry) => entry.path)).toEqual(["README.md", "nested"]);
      expect(reader.diagnostics()).toEqual([
        { path: "fleet-kit", reason: "protected_path", detail: expect.any(String) },
        { path: "fleet-kit/answers.json", reason: "protected_path", detail: expect.any(String) },
        { path: "nested/fleet-kit", reason: "protected_path", detail: expect.any(String) },
        { path: "nested/fleet-kit/more.json", reason: "protected_path", detail: expect.any(String) },
      ]);
      for (const request of ["fleet-kit/answers.json", "../../etc/passwd", "/etc/passwd", "README.md/../fleet-kit/answers.json", ".git/config", "a\\b", "./README.md"]) {
        const result = await reader.read(request);
        expect(result.ok, request).toBe(false);
      }
      expect(reader.usage()).toEqual({ files: 0, bytes: 0 });
    });

    it("lists files that commonly hold credentials but never reads them", async () => {
      const sensitive = [".npmrc", "packages/web/.npmrc", ".yarnrc.yml", ".env", ".env.production", "config/.netrc", "certs/server.pem", "certs/tls.KEY", "deploy/id_ed25519", ".git-credentials"];
      for (const file of sensitive) work.write(file, "//registry.example.test/:_authToken=secret-value\n");
      work.write("README.md", "hello\n").write("env.ts", "export {};\n").write("keys.md", "no\n");
      const reader = await snapshotReader();

      expect(sensitive.every((file) => reader.entry(file)?.type === "file")).toBe(true);
      const results = await reader.readMany([...sensitive, "README.md", "env.ts", "keys.md"]);
      for (const file of sensitive) expect(results.get(file), file).toMatchObject({ ok: false, skip: { reason: "sensitive" } });
      for (const file of ["README.md", "env.ts", "keys.md"]) expect(results.get(file), file).toMatchObject({ ok: true });
      expect(reader.usage()).toEqual({ files: 3, bytes: 6 + 11 + 3 });
    });

    it("never materializes a working tree", async () => {
      work.write("README.md", "hello\n").write("src/index.js", "console.log(1);\n");
      const reader = await snapshotReader();
      await reader.readMany(reader.files().map((entry) => entry.path));

      const storageFiles = fs.readdirSync(world.config.repositoryStorage, { recursive: true, encoding: "utf8" });
      expect(storageFiles.filter((file) => file.endsWith("README.md") || file.endsWith("index.js"))).toEqual([]);
    });
  });

  describe("binary content and budgets", () => {
    it("classifies binary and non-UTF-8 content without parsing it", async () => {
      work.write("logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])).write("latin1.txt", Buffer.from([0x63, 0x61, 0x66, 0xe9]));
      const reader = await snapshotReader();

      const results = await reader.readMany(["logo.png", "latin1.txt"]);
      for (const file of ["logo.png", "latin1.txt"]) expect(results.get(file)).toMatchObject({ ok: true, content: { binary: true, text: null } });
      expect(reader.diagnostics().map((diagnostic) => [diagnostic.path, diagnostic.reason])).toEqual([
        ["latin1.txt", "binary"],
        ["logo.png", "binary"],
      ]);
    });

    it("skips a file larger than the per-blob limit and accepts one exactly at it", async () => {
      work.write("at-limit.txt", "x".repeat(100)).write("over-limit.txt", "x".repeat(101));
      const reader = await snapshotReader({ ...GENEROUS, maxBlobBytes: 100 });

      expect(await reader.read("at-limit.txt")).toMatchObject({ ok: true });
      expect(await reader.read("over-limit.txt")).toMatchObject({ ok: false, skip: { reason: "blob_too_large", detail: "101 bytes exceeds the 100-byte limit per file" } });
    });

    it("holds lockfiles to their own per-file limit rather than the per-blob one", async () => {
      work.write("package-lock.json", `{"x":"${"x".repeat(140)}"}`).write("notes.txt", "x".repeat(150));
      const reader = await snapshotReader({ ...GENEROUS, maxBlobBytes: 100, maxLockfileBytes: 200 });

      expect(await reader.read("package-lock.json")).toMatchObject({ ok: true });
      expect(await reader.read("notes.txt")).toMatchObject({ ok: false, skip: { reason: "blob_too_large" } });
    });

    it("stops at the file-count budget", async () => {
      for (const name of ["a", "b", "c", "d"]) work.write(`${name}.txt`, `${name}\n`);
      const reader = await snapshotReader({ ...GENEROUS, maxFiles: 3 });

      const results = await reader.readMany(["d.txt", "c.txt", "b.txt", "a.txt"]);
      expect([...results.entries()].map(([file, result]) => [file, result.ok])).toEqual([
        ["a.txt", true],
        ["b.txt", true],
        ["c.txt", true],
        ["d.txt", false],
      ]);
      expect(results.get("d.txt")).toMatchObject({ ok: false, skip: { reason: "file_budget_exhausted" } });
    });

    it("stops at the total-byte budget, counting exactly up to it", async () => {
      work.write("a.txt", "x".repeat(40)).write("b.txt", "x".repeat(60)).write("c.txt", "x");
      const reader = await snapshotReader({ ...GENEROUS, maxTotalBytes: 100 });

      const results = await reader.readMany(["a.txt", "b.txt", "c.txt"]);
      expect(results.get("a.txt")?.ok).toBe(true);
      expect(results.get("b.txt")?.ok).toBe(true);
      expect(results.get("c.txt")).toMatchObject({ ok: false, skip: { reason: "total_budget_exhausted" } });
      expect(reader.usage()).toEqual({ files: 2, bytes: 100 });
    });

    it("produces identical diagnostics for identical reads", async () => {
      for (const name of ["a", "b", "c"]) work.write(`${name}.txt`, "x".repeat(50));
      work.write("big.bin", Buffer.alloc(300, 0));
      const budgets = { maxBlobBytes: 200, maxLockfileBytes: 200, maxFiles: 10, maxTotalBytes: 120 };

      work.commit();
      const source = registerLocalSource(world.db, world.config, "orders", work.path);
      const readerFor = async () => {
        const { target, snapshot } = await acquire(world.db, world.config, source);
        return openSnapshot(target, snapshot, { config: world.config, budgets });
      };
      const first = await readerFor();
      await first.readMany(["c.txt", "big.bin", "a.txt", "b.txt"]);
      const second = await readerFor();
      await second.readMany(["b.txt", "a.txt", "big.bin", "c.txt"]);

      expect(second.diagnostics()).toEqual(first.diagnostics());
      expect(first.diagnostics().map((diagnostic) => [diagnostic.path, diagnostic.reason])).toEqual([
        ["big.bin", "blob_too_large"],
        ["c.txt", "total_budget_exhausted"],
      ]);
    });
  });
});
