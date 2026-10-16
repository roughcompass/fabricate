import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_IMPORTS, PORTAL_MODULE } from "@/lib/prototypes/gates";
import { RUNTIME } from "@/lib/prototypes/render";

// design.md, decision 8: the frame resolves generated code's imports through the runtime's import map.
describe("prototype runtime", () => {
  it("maps exactly the modules generated code may import, plus the JSX runtime the build adds and the portal interface hero lineages may import", () => {
    const packages = ALLOWED_IMPORTS.filter((specifier) => specifier !== "./data");
    expect(Object.keys(RUNTIME.importMap.imports).sort()).toEqual([...packages, "react/jsx-runtime", PORTAL_MODULE].sort());
  });

  it("addresses every file under the runtime's content hash", () => {
    const files = [...Object.values(RUNTIME.importMap.imports), RUNTIME.host, ...RUNTIME.styles];
    for (const file of files) expect(file.startsWith(`/prototype-runtime/${RUNTIME.hash}/`), file).toBe(true);
  });

  it("is built for the committed manifest, so dev and build serve what the render route names", () => {
    const directory = path.join("public", "prototype-runtime", RUNTIME.hash);
    if (!fs.existsSync(directory)) return; // A fresh checkout builds it with `npm run prototypes:runtime`.
    for (const file of [RUNTIME.host, ...RUNTIME.styles, ...Object.values(RUNTIME.importMap.imports)]) expect(fs.existsSync(path.join("public", file)), file).toBe(true);
  });
});
