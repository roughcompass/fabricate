import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findOutputDirectory, validateOutput } from "@/lib/previews/output";

/*
 * A preview build's output (design decision 4, step 5): one output directory
 * from literal configuration or convention, only regular files within it,
 * under the size limit, and index.html, the page that loads the application
 * on its own, whatever kind of package built it.
 */

const BASE = "/previews/pvw_abcdefghijklmnop/";
const COMMITTED = new Date(Date.UTC(2026, 0, 1));

describe("preview build output", () => {
  let root: string;
  let since: number;
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preview-output-")));
    since = Date.now() - 1_000;
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  /** Writes +files+ under the package; committed ones carry the commit's time, as `git archive` extracts them. */
  const write = (files: Record<string, string>, options: { committed?: boolean } = {}) => {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      if (options.committed) fs.utimesSync(target, COMMITTED, COMMITTED);
    }
  };
  const validate = (maxBytes = 1_000_000) => validateOutput(path.join(root, "dist"), { base: BASE, maxBytes });

  describe("output directory", () => {
    it("is the conventional directory the build wrote, not a committed one of the same kind", async () => {
      write({ "build/webpack.helpers.js": "module.exports = {};\n" }, { committed: true });
      write({ "dist/index.html": "<!doctype html>" });
      expect(await findOutputDirectory(root, "webpack", since)).toBe("dist");
    });

    it("is the directory a tool's configuration names literally", async () => {
      write({ "vite.config.ts": 'export default { build: { outDir: "./public-build/" } };\n' }, { committed: true });
      write({ "public-build/index.html": "<!doctype html>", "dist/stale.txt": "x" });
      expect(await findOutputDirectory(root, "vite", since)).toBe("public-build");

      write({ "rspack.config.cjs": 'module.exports = { output: { path: path.resolve(__dirname, "www") } };\n' }, { committed: true });
      write({ "www/remoteEntry.js": "var app;" });
      expect(await findOutputDirectory(root, "rspack", since)).toBe("www");
    });

    it("is never guessed among several, and must exist", async () => {
      await expect(findOutputDirectory(root, "vite", since)).rejects.toThrow("The build wrote no output into dist or build.");
      write({ "dist/index.html": "<!doctype html>", "build/index.html": "<!doctype html>" });
      await expect(findOutputDirectory(root, "webpack", since)).rejects.toThrow("The build wrote output into dist and build, so which one to publish can't be decided.");
    });

    it("is never a symbolic link", async () => {
      write({ "elsewhere/index.html": "<!doctype html>" });
      fs.symlinkSync(path.join(root, "elsewhere"), path.join(root, "dist"));
      await expect(findOutputDirectory(root, "vite", since)).rejects.toThrow("The output directory dist is a symbolic link. Previews publish only regular files.");
    });
  });

  describe("the page", () => {
    it("is index.html, recorded with whether it refers to assets outside the preview's base path", async () => {
      write({ "dist/index.html": `<!doctype html><script type="module" src="${BASE}assets/app.js"></script><link rel="icon" href="./favicon.ico">`, "dist/assets/app.js": "console.log(1);\n" });
      expect(await validate()).toEqual({ files: 2, bytes: expect.any(Number), entry: { file: "index.html", rebase: false } });

      write({ "dist/index.html": "<!doctype html><script type=module src=/assets/app.js></script>" });
      expect((await validate()).entry.rebase).toBe(true);
    });

    it("publishes a Module Federation remote through the page its build emitted", async () => {
      write({ "dist/index.html": '<!doctype html><script defer src="main.js"></script><script defer src="remoteEntry.js"></script>', "dist/main.js": "1;\n", "dist/remoteEntry.js": 'var mfAdmin;(()=>{"use strict";var e={}})();\n' });
      expect((await validate()).entry).toEqual({ file: "index.html", rebase: false });
    });

    it.each([
      ["a Module Federation remote's container alone", { "dist/remoteEntry.js": "var mfAdmin;\n", "dist/706.js": "1;\n" }],
      ["a single-spa lifecycle bundle", { "dist/assets/spa-orders.js": 'System.register(["react"],function(e){return{execute:function(){e({bootstrap:1,mount:2,unmount:3})}}});\n' }],
      ["a page in a subdirectory", { "dist/demo/index.html": "<!doctype html>" }],
    ])("is required, so %s isn't published", async (_label, files) => {
      write(files);
      await expect(validate()).rejects.toThrow("The output has no index.html. Previews need a page that loads the application on its own.");
    });
  });

  describe("files", () => {
    it("refuses a symbolic link anywhere in the output", async () => {
      write({ "dist/index.html": "<!doctype html>" });
      fs.mkdirSync(path.join(root, "dist/assets"));
      fs.symlinkSync("/etc/hosts", path.join(root, "dist/assets/hosts"));
      await expect(validate()).rejects.toThrow("The output contains a symbolic link, assets/hosts. Previews publish only regular files.");
    });

    it("refuses output over the size limit, naming the limit", async () => {
      write({ "dist/index.html": "<!doctype html>", "dist/big.bin": "x".repeat(4_096) });
      await expect(validate(2_048)).rejects.toThrow("The output is larger than 2 KiB, the limit previews.maxOutputBytes sets.");
      await expect(validate(100)).rejects.toThrow("The output is larger than 100 bytes, the limit previews.maxOutputBytes sets.");
    });
  });
});
