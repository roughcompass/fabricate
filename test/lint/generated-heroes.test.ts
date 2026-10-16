import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generatedFileProblems } from "@/lib/prototypes/heroes/check";
import type { HeroManifest } from "@/lib/prototypes/heroes/generate";

/**
 * Generated hero source uses only Salt's tokens (converge-templates-and-
 * prototypes, design decision 11), checked like the stylesheets in
 * design-tokens.test.ts: every file under src/demo/runtime/generated/, with
 * the manifest's planted rules as each version's only exemptions.
 */

const GENERATED = path.resolve("src/demo/runtime/generated");
// Every token the theme the runtime loads defines, read from its CSS.
const SALT_TOKENS = new Set(["node_modules/@salt-ds/theme/index.css", "node_modules/@salt-ds/theme/css/theme-next.css"].flatMap((file) => [...fs.readFileSync(path.resolve(file), "utf8").matchAll(/(--salt-[A-Za-z0-9-]+)\s*:/g)].map((match) => match[1]!)));

function sourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sourceFiles(path.join(directory, entry.name)) : entry.name.endsWith(".tsx") ? [path.join(directory, entry.name)] : []));
}

describe("generated hero source", () => {
  it("uses only Salt's tokens, except where the manifest names a planted rule", () => {
    const manifestFile = path.join(GENERATED, "manifest.json");
    const manifest = fs.existsSync(manifestFile) ? (JSON.parse(fs.readFileSync(manifestFile, "utf8")) as HeroManifest) : null;
    const planted = new Map(manifest?.heroes.flatMap((hero) => hero.versions.map((version) => [path.join(GENERATED, version.file), version.planted])) ?? []);
    const problems = sourceFiles(GENERATED).flatMap((file) => generatedFileProblems(fs.readFileSync(file, "utf8"), planted.get(file) ?? [], SALT_TOKENS).map((problem) => `${path.relative(GENERATED, file)}: ${problem}`));
    expect(problems).toEqual([]);
  });

  describe("the check", () => {
    const member = (style: string) => `import { Text } from "@salt-ds/core";\nexport default function Member() {\n  return <Text style={${style}}>Payees</Text>;\n}\n`;

    it("fails a raw color in a file that isn't planted", () => {
      expect(generatedFileProblems(member('{ color: "#b0b0b0" }'), [], SALT_TOKENS)).toEqual([expect.stringMatching(/#b0b0b0|literal color|color/i)]);
    });

    it("allows the raw color a planted contrast defect needs, and nothing else", () => {
      expect(generatedFileProblems(member('{ color: "#b0b0b0" }'), ["color-contrast"], SALT_TOKENS)).toEqual([]);
      expect(generatedFileProblems(member('{ color: "#b0b0b0" }'), ["label"], SALT_TOKENS)).not.toEqual([]);
    });

    it("fails a --salt- token Salt's theme doesn't define, and passes one it does", () => {
      expect(SALT_TOKENS.has("--salt-content-secondary-foreground")).toBe(true);
      expect(generatedFileProblems(member('{ color: "var(--salt-content-secondary-foreground)" }'), [], SALT_TOKENS)).toEqual([]);
      expect(generatedFileProblems(member('{ color: "var(--salt-made-up-token)" }'), [], SALT_TOKENS)).toEqual(["--salt-made-up-token isn't a token Salt's theme defines."]);
    });
  });
});
