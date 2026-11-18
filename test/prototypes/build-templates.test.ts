import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/lib/demo/catalog";
import { type Reader, TemplateBuildError, buildTemplate, buildTemplates, builtFiles, canonicalSource, directoryReader, diskSource } from "@/lib/prototypes/heroes/build";

// update-templates-salt-quality, design decision 3: building the templates from committed Salt source, without a model.

const FX = TEMPLATES.find((template) => template.slug === "fx-rates-board")!;
const committed = directoryReader();
const editing = (changes: Record<string, string | null>): Reader => (file) => (file in changes ? changes[file]! : committed(file));

describe("building the templates", () => {
  it("gates every member version with its CSS module and composes the page at the conformant versions", async () => {
    const problems: { file: string; message: string }[] = [];
    const built = (await buildTemplate(FX, committed, problems))!;
    expect(problems).toEqual([]);
    expect(built.versions.map((version) => `${version.member}@${version.version}`)).toEqual(["fx-rates@1.0.0", "fx-rates@1.1.0", "rate-detail@1.0.0"]);
    for (const version of built.versions) {
      expect(version.gates.map((result) => `${result.gate}:${result.status}`)).toEqual(["salt-only:passed", "typecheck:passed", "salt-usage:passed", "build:passed"]);
      // The gates read members as Prototypes does: ./data and ./Prototype.module.css.
      expect(version.code).toContain('from "./data"');
      expect(version.code).toContain('from "./Prototype.module.css"');
      expect(version.stylesFile).toBe(version.file.replace(/\.tsx$/, ".module.css"));
    }
    expect(built.page.regions).toEqual([
      { member: "fx-rates", version: "1.1.0", area: "main" },
      { member: "rate-detail", version: "1.0.0", area: "side" },
    ]);
    expect(built.page.styles).toContain(".FxRates_selected");
    expect(built.page.gates.every((result) => result.status === "passed")).toBe(true);
  });

  it("names every failing file, gate, and line, and every Salt token the theme doesn't define (A failing file stops the build)", async () => {
    const file = "fx-rates-board/rate-detail/1.0.0.tsx";
    const broken = committed(file)!.replace('<Text color="secondary">{pair.name}</Text>', '<Text style={{ color: "var(--salt-made-up-token)" }}>{pair.name}</Text>');
    const error = await buildTemplates(editing({ [file]: broken, "fx-rates-board/fx-rates/1.1.0.tsx": null }), { slugs: ["fx-rates-board"] }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TemplateBuildError);
    const messages = (error as TemplateBuildError).problems.map((problem) => `${problem.file}: ${problem.message}`);
    expect(messages).toContain("fx-rates-board/fx-rates/1.1.0.tsx: is missing.");
    expect(messages).toContainEqual(expect.stringMatching(/^fx-rates-board\/rate-detail\/1\.0\.0\.tsx: salt-only salt-only\/inline-style \(line \d+\)/));
    expect(messages).toContain("fx-rates-board/rate-detail/1.0.0.tsx: --salt-made-up-token isn't a token Salt's theme defines.");
  });

  it("writes each page beside its merged module, the index, the sources, and a manifest without source text", async () => {
    const { templates } = await buildTemplates(committed, { slugs: ["fx-rates-board"] });
    const files = builtFiles(templates, []);
    expect(Object.keys(files).sort()).toEqual(["fx-rates-board/page.module.css", "fx-rates-board/page.tsx", "index.ts", "manifest.json", "sources.ts"]);
    expect(files["fx-rates-board/page.tsx"]).toContain('import styles from "./page.module.css";');
    expect(files["index.ts"]).toContain('import fx_rates_1_1_0 from "./fx-rates-board/fx-rates/1.1.0";');
    expect(files["index.ts"]).toContain('"fx-rates": { "1.0.0": fx_rates_1_0_0, "1.1.0": fx_rates_1_1_0 },');
    expect(files["sources.ts"]).toContain('"pageStyles": "/* fx-rates 1.1.0 */');
    const manifest = JSON.parse(files["manifest.json"]!);
    expect(manifest).toMatchObject({ schema: "fabricate.template_manifest", schema_version: 2, templates: [{ slug: "fx-rates-board", data: "fx-rates-board/data.ts", page: { file: "fx-rates-board/page.tsx", stylesFile: "fx-rates-board/page.module.css" } }] });
    expect(files["manifest.json"]).not.toContain('"code"');
  });

  it("maps a member's imports between disk and Prototypes both ways", () => {
    const file = "fx-rates-board/fx-rates/1.0.0.tsx";
    const disk = committed(file)!;
    expect(diskSource(canonicalSource(disk, file), file, true)).toBe(disk);
  });
});
