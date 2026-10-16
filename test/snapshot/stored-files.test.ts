import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_BUDGETS, MemoryReader } from "@repo-facts/contract";
import { type ReaderFactory, readerConformanceCases } from "@repo-facts/contract/testing";
import { describe, expect, it } from "vitest";
import { openStoredFiles, treeObjectId } from "@/lib/snapshot/stored-files";

// converge-templates-and-prototypes design.md, decision 1: a template version's
// export is read in memory under the shared read policy, digested as a Git tree.

describe("the stored-files reader", () => {
  const factory: ReaderFactory = async (files, options) => {
    const plain = Object.fromEntries(Object.entries(files).flatMap(([name, file]) => (typeof file === "string" || file instanceof Uint8Array ? [[name, file]] : [])));
    // Stored files are regular files only; cases with links or executables go to the reference reader as they are.
    if (Object.keys(plain).length !== Object.keys(files).length) {
      return MemoryReader.fromFiles(files, { budgets: options.budgets ?? DEFAULT_BUDGETS, protectedDirectories: ["fleet-kit", ...(options.protectedDirectories ?? [])] });
    }
    return openStoredFiles(plain, options.budgets ?? DEFAULT_BUDGETS, options.protectedDirectories ? { protectedDirectories: options.protectedDirectories } : {}).reader;
  };
  for (const test of readerConformanceCases()) it(`conforms: ${test.name}`, () => test.run(factory));

  it("refuses a file that commonly holds credentials, with a diagnostic", async () => {
    const { reader } = openStoredFiles({ "src/App.tsx": "export {};\n", ".env": "TOKEN=secret\n" }, DEFAULT_BUDGETS);
    const read = await reader.read(".env");
    expect(read.ok).toBe(false);
    expect(reader.diagnostics().some((diagnostic) => diagnostic.path === ".env")).toBe(true);
    expect((await reader.read("src/App.tsx")).ok).toBe(true);
  });

  it("digests the files as the Git tree id git write-tree computes, the same for the same files", () => {
    const files = { "package.json": "{}\n", "src/main.tsx": "export {};\n", "src/data.ts": "export const rows = [];\n", "src-x.txt": "x\n", README: "Hi\n" };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stored-files-"));
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
      git("init", "-q");
      for (const [name, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), content);
      }
      git("add", "-A");
      expect(treeObjectId(files)).toBe(git("write-tree"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(treeObjectId({ ...files })).toBe(treeObjectId(files));
    expect(treeObjectId({ ...files, README: "Hello\n" })).not.toBe(treeObjectId(files));
  });
});
