import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Generated hero source names only tokens Salt's theme defines
 * (converge-templates-and-prototypes, design decision 11), checked like the
 * stylesheets in design-tokens.test.ts: every file under
 * src/demo/runtime/generated/.
 */

const GENERATED = path.resolve("src/demo/runtime/generated");
// Every token the theme the runtime loads defines, read from its CSS.
const SALT_TOKENS = new Set(["node_modules/@salt-ds/theme/index.css", "node_modules/@salt-ds/theme/css/theme-next.css"].flatMap((file) => [...fs.readFileSync(path.resolve(file), "utf8").matchAll(/(--salt-[A-Za-z0-9-]+)\s*:/g)].map((match) => match[1]!)));
const SALT_TOKEN = /var\(\s*(--salt-[a-z0-9-]+)/gi;

function sourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sourceFiles(path.join(directory, entry.name)) : entry.name.endsWith(".tsx") ? [path.join(directory, entry.name)] : []));
}

/** Every `--salt-` token a file names that Salt's theme doesn't define. */
function unknownTokens(code: string): string[] {
  return [...new Set([...code.matchAll(SALT_TOKEN)].map((match) => match[1]!))].filter((token) => !SALT_TOKENS.has(token));
}

describe("generated hero source", () => {
  it("names only tokens Salt's theme defines", () => {
    const files = sourceFiles(GENERATED);
    expect(files.length).toBeGreaterThan(0);
    const problems = files.flatMap((file) => unknownTokens(fs.readFileSync(file, "utf8")).map((token) => `${path.relative(GENERATED, file)}: ${token} isn't a token Salt's theme defines.`));
    expect(problems).toEqual([]);
  });

  it("fails a --salt- token Salt's theme doesn't define, and passes one it does", () => {
    expect(SALT_TOKENS.has("--salt-content-secondary-foreground")).toBe(true);
    expect(unknownTokens('<Text style={{ color: "var(--salt-content-secondary-foreground)" }} />')).toEqual([]);
    expect(unknownTokens('<Text style={{ color: "var(--salt-made-up-token)" }} />')).toEqual(["--salt-made-up-token"]);
  });
});
