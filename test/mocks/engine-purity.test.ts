import path from "node:path";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

/*
 * The matching engine stays pure (add-mock-sets, design decision 4, task
 * 1.6): the routing worker's bundle holds it, so bundling `engine.ts` and
 * `compiled.ts` for the browser must pull in nothing but themselves, and no
 * Node built-in, React, or database module.
 */

const ENGINE = ["src/lib/mocks/engine.ts", "src/lib/mocks/compiled.ts"];

describe("the matching engine", () => {
  it("bundles for the browser from its own two modules alone", async () => {
    const result = await build({
      entryPoints: ENGINE.map((file) => path.resolve(file)),
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      metafile: true,
      outdir: "out",
      logLevel: "silent",
      // Anything external would be reported as an import of the bundle rather than fail it.
      external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`), "react", "react-dom", "@/lib/db/*"],
    });
    const inputs = Object.keys(result.metafile.inputs).map((input) => path.relative(process.cwd(), path.resolve(input)));
    expect(inputs.sort()).toEqual([...ENGINE].sort());
    const imports = Object.values(result.metafile.outputs).flatMap((output) => output.imports.map((item) => item.path));
    expect(imports).toEqual([]);
    for (const input of Object.values(result.metafile.inputs)) {
      for (const item of input.imports) expect(item.path, `imported by the engine`).not.toMatch(/^(node:|react|@\/lib\/db)|^(fs|path|crypto|os|url|stream|buffer)$/);
    }
  });
});
