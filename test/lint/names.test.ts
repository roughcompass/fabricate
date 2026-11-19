import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/*
 * The name check (establish-frontend-registry, design decision 9). The
 * product's old names don't come back: not in identifiers, file names,
 * strings, or comments of the code, the scripts, the tests, or the
 * configuration. Only the names stored data, published packages, and
 * repositories depend on are kept, each where it's needed, along with the
 * names still read for one release as fallbacks. Applied migrations
 * (drizzle/) are history and aren't read. Model terms the code no longer uses
 * for its records are banned in identifiers, outside the storage mappings.
 */

const ROOTS = ["src", "scripts", "e2e", "test", "config"];
const ROOT_FILES = [".npmrc", "package.json", "next.config.ts", "eslint.config.mjs", "playwright.base.ts", "playwright.config.ts", "playwright.demo-off.config.ts", "playwright.fleet.config.ts", "vitest.config.ts", "drizzle.config.ts", "knip.json", "knip.production.json", "tsconfig.json"];
const SCANNED = /\.(ts|tsx|mts|mjs|js|json|css|yaml|yml|md)$|^\.npmrc$/;
const CODE = /\.(ts|tsx|mts|mjs|js)$/;
const SELF = "test/lint/names.test.ts";

/** Old product names, in any case or spelling. */
const OLD_NAMES = /fabricate|fablab|repo[-_ ]?facts|detector[-_ ]?releases?/i;

/** Names kept everywhere, because stored data, published packages, or Git mirrors depend on them (design.md, the renaming inventory). */
const KEPT: readonly RegExp[] = [
  // The npm scope Surveyor publishes under, and its import specifiers.
  /@repo-facts\b/g,
  // Document schemas inside every stored document and Standard file.
  /\bfabricate\.(?:repository_profile|relationship_map|standard|finding|evaluator_configuration)\b/g,
  /\brepo_facts\.(?:fact_document|detector_configuration)\b/g,
  /\brepo-facts-css\b/g,
  // Stored columns and document fields.
  /\bdetector_release\b/g,
  // The namespace of the Git refs in every managed mirror, also as escaped in regular expressions.
  /refs\\?\/fabricate\\?\//g,
  // The default database file in deployments' storage directories.
  /\bstorage\/fabricate\.sqlite3\b/g,
  // The demo workspace and share-view cookies, which visitors' browsers hold.
  /\bfabricate_demo_(?:workspace|view_)/g,
];

/** Names kept in one file only. */
const KEPT_IN: Readonly<Record<string, readonly RegExp[]>> = {
  // The names still read for one release, all in one module.
  "src/lib/legacy-names.ts": [OLD_NAMES],
  // The registry variables' old names, which the release scripts still read for one release.
  "scripts/release.mjs": [/\bREPO_FACTS_NPM_REGISTRY\b/g],
  "scripts/verify-release.mjs": [/\bREPO_FACTS_NPM_TOKEN\b/g, /\(\?:SURVEYOR\|REPO_FACTS\)_NPM_TOKEN/g, /\brepoFacts\b/g],
  // Tests of those fallbacks.
  "test/config/configuration.test.ts": [/\bFABRICATE_\w*/g, /\bfabricate\.json\b/g],
  "test/web/preference-cookies.test.ts": [/\bfabricate-(?:theme|sidebar-width|sidebar)\b/g],
  "test/app/sidebar-actions.test.ts": [/\bfabricate-sidebar\b/g],
  "test/web/demo-storage.test.ts": [/\bfabricate-demo\b/g],
  // The repository golden fact documents are copied from, by its name.
  "test/fixtures/fact-documents/SOURCE.json": [/"repository": "repo-facts"/g],
  "test/profiles/fact-document-fixtures.test.ts": [/repository: "repo-facts"/g],
  // The vocabulary crawl's own list of banned names.
  "e2e/links.spec.ts": [/const OLD_PRODUCT_NAMES = \[.*\];/g],
};

/** Model terms the code doesn't use as record names, in identifiers; snake_case names map stored columns and rows. */
const BANNED_IDENTIFIERS = [/initiative/i, /RepositorySource/, /(?:^|[^a-zA-Z])sourceIds?(?![a-z])|SourceIds?(?![a-z])/];
const STORED = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** Every old name in +text+ outside the kept names, with its line. */
function oldNames(file: string, text: string): Violation[] {
  let rest = text;
  for (const pattern of [...KEPT, ...(KEPT_IN[file] ?? [])]) rest = rest.replace(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`), (match) => " ".repeat(match.length));
  const found: Violation[] = [];
  const global = new RegExp(OLD_NAMES.source, "gi");
  for (let match = global.exec(rest); match; match = global.exec(rest)) {
    found.push({ file, line: rest.slice(0, match.index).split("\n").length, text: match[0] });
  }
  return found;
}

/** Every identifier in +text+ that names a record by a model term the code no longer uses. */
function bannedIdentifiers(file: string, text: string): Violation[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Violation[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) && !STORED.test(node.text) && BANNED_IDENTIFIERS.some((pattern) => pattern.test(node.text))) {
      found.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function files(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : files(full);
    return [full];
  });
}

const relative = (file: string) => path.relative(process.cwd(), file).split(path.sep).join("/");
const scanned = [...ROOTS.flatMap((root) => files(path.resolve(root))), ...ROOT_FILES.map((name) => path.resolve(name)).filter((file) => fs.existsSync(file))]
  .map(relative)
  .filter((file) => file !== SELF);

const describeViolation = ({ file, line, text }: Violation) => `${file}:${line} ${text}`;

describe("the name check", () => {
  it("finds no old product name in a file name", () => {
    expect(scanned.filter((file) => OLD_NAMES.test(path.basename(file)))).toEqual([]);
  });

  it("finds no old product name in the code, scripts, tests, or configuration, outside the kept names", () => {
    const found = scanned.filter((file) => SCANNED.test(path.basename(file))).flatMap((file) => oldNames(file, fs.readFileSync(file, "utf8")));
    expect(found.map(describeViolation)).toEqual([]);
  });

  it("finds no identifier that names a record Initiative, RepositorySource, or sourceId", () => {
    const found = scanned.filter((file) => CODE.test(file)).flatMap((file) => bannedIdentifiers(file, fs.readFileSync(file, "utf8")));
    expect(found.map(describeViolation)).toEqual([]);
  });

  it("fails on planted old names, and passes once they're removed", () => {
    expect(oldNames("src/lib/planted.ts", "export interface FabricateConfig {}").map((found) => found.text)).toEqual(["Fabricate"]);
    expect(oldNames("src/app/planted.tsx", 'const label = "Detector release";').map((found) => found.text)).toEqual(["Detector release"]);
    expect(oldNames("src/app/planted.tsx", "// Shown by DE FabLab, from repo-facts.").map((found) => found.text)).toEqual(["FabLab", "repo-facts"]);
    expect(oldNames("src/lib/planted.ts", 'const repoFacts = process.env.REPO_FACTS_NPM_TOKEN; const x = "fabricate-theme";').map((found) => found.text)).toEqual(["repoFacts", "REPO_FACTS", "fabricate"]);
    expect(oldNames("src/lib/planted.ts", "export interface FrontendRegistryConfig {}")).toEqual([]);
  });

  it("keeps the names stored data and published packages depend on", () => {
    const kept = [
      'import { analyze } from "@repo-facts/bundle";',
      'const schema = "fabricate.repository_profile";',
      'const facts = "repo_facts.fact_document";',
      'surveyorRelease: text("detector_release"),',
      "const ref = `refs/fabricate/snapshots/${id}`;",
      "const pattern = /^refs\\/fabricate\\/snapshots\\/srv_/;",
      'database: "storage/fabricate.sqlite3",',
      'export const WORKSPACE_COOKIE = "fabricate_demo_workspace";',
    ];
    expect(kept.flatMap((line) => oldNames("src/lib/planted.ts", line))).toEqual([]);
    expect(oldNames("src/lib/planted.ts", 'const old = "FABRICATE_DATABASE";').map((found) => found.text)).toEqual(["FABRICATE"]);
  });

  it("fails on planted model-term identifiers, but not on stored names or strings", () => {
    const planted = "const initiativeId = 1; type Row = RepositorySource; function load(sourceId: string) {}";
    expect(bannedIdentifiers("src/lib/planted.ts", planted).map((found) => found.text)).toEqual(["initiativeId", "RepositorySource", "sourceId"]);
    const stored = 'const rows = db.all<{ initiative_id: number; repository_source_id: number }>(sql`select initiative_id from initiatives`); const field = "sourcePublicIds";';
    expect(bannedIdentifiers("src/lib/planted.ts", stored)).toEqual([]);
    expect(bannedIdentifiers("src/lib/planted.ts", "const assessmentId = 1; const repositoryId = 2; const resourceIds = [];")).toEqual([]);
  });
});
