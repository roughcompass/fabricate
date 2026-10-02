import { SHARED_CATEGORIES } from "@repo-facts/contract";
import { beforeAll, describe, expect, it } from "vitest";
import { dependencyGroups, missingCell, scriptGroups } from "@/lib/profiles/joins";
import type { FactDocument } from "@/lib/profiles/states";
import { analyzedFacts, factDocumentFixture } from "../../support/fact-documents";
import { manifest } from "../../support/profiles";

const definition = (id: string) => SHARED_CATEGORIES.find((candidate) => candidate.id === id)!;
const names = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => `pkg-${from + index}`);
const pinned = (packages: string[]) => Object.fromEntries(packages.map((name) => [name, "1.0.0"]));
const lockfile = (name: string, production: string[], development: string[]) =>
  manifest({ name, lockfileVersion: 3, requires: true, packages: { "": { name, dependencies: pinned(production), devDependencies: pinned(development) }, ...Object.fromEntries([...production, ...development].map((dependency) => [`node_modules/${dependency}`, { version: "1.0.0" }])) } });

const RESOLVED = { absent: "Not found by a complete search", unknown: "No lockfile entry was found for this package" };

describe("Tables that related categories share", () => {
  // A CLI with a template, like create-web-app: 59 declared dependencies across two manifests, 52 distinct packages.
  const root = { production: names(0, 4), development: names(4, 12) };
  const template = { production: names(12, 20), development: [...names(5, 12), ...names(20, 52)] };
  let cli: FactDocument;
  let unlocked: FactDocument;
  let storefront: FactDocument;

  beforeAll(async () => {
    cli = await analyzedFacts({
      "template/package.json": manifest({ name: "{{PACKAGE_NAME}}", version: "0.1.0", private: true, dependencies: pinned(template.production), devDependencies: pinned(template.development) }),
      "template/package-lock.json": lockfile("template", template.production, template.development),
      "package.json": manifest({ name: "cli", version: "0.1.0", dependencies: pinned(root.production), devDependencies: pinned(root.development) }),
      "package-lock.json": lockfile("cli", root.production, root.development),
    });
    unlocked = await analyzedFacts({ "package.json": manifest({ name: "orders", dependencies: { axios: "^1.6.0", zod: "^3.0.0" } }) });
    storefront = await analyzedFacts({
      "package.json": manifest({ name: "storefront", scripts: { build: "vite build", test: "vitest run", start: "vite" }, devDependencies: { vite: "7.0.0", vitest: "3.2.0" } }),
      ".github/workflows/ci.yml": "name: ci\non: [push]\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm test\n",
    });
  });

  it("joins declared and resolved dependencies into one row per manifest and package, the root manifest first", () => {
    expect(cli.categories.dependencies!.facts).toHaveLength(59);
    expect(cli.categories.resolved_dependencies!.facts).toHaveLength(59);
    const groups = dependencyGroups(cli);
    expect(groups.map((group) => [group.manifest, group.rows.length])).toEqual([
      ["package.json", 12],
      ["template/package.json", 47],
    ]);
    const rows = groups.flatMap((group) => group.rows);
    expect(rows.every((row) => row.declared && row.resolved && row.consumed)).toBe(true);
    // A package both manifests declare is a row in each, sharing its consumed fact.
    const shared = rows.filter((row) => row.name === "pkg-5");
    expect(shared.map((row) => row.manifest)).toEqual(["package.json", "template/package.json"]);
    expect(shared[0]!.consumed).toBe(shared[1]!.consumed);
    expect(groups[0]!.rows.map((row) => row.name)).toEqual([...names(0, 12)].sort());
  });

  it("gives a package that one manifest declares in two fields a row per field, sharing its resolved version", () => {
    const workspace = factDocumentFixture("npm-workspace") as unknown as FactDocument;
    const react = dependencyGroups(workspace)
      .flatMap((group) => group.rows)
      .filter((row) => row.manifest === "packages/web/package.json" && row.name === "react");
    expect(react.map((row) => (row.declared?.value as { field: string }).field)).toEqual(["dependencies", "peerDependencies"]);
    expect(react[0]!.resolved).not.toBeNull();
    expect(react[0]!.resolved).toBe(react[1]!.resolved);
  });

  it("shows every resolved version as unknown when no lockfile is committed, never none detected", () => {
    const rows = dependencyGroups(unlocked).flatMap((group) => group.rows);
    expect(rows.map((row) => [row.name, Boolean(row.declared), row.resolved])).toEqual([
      ["axios", true, null],
      ["zod", true, null],
    ]);
    const cell = missingCell(unlocked, definition("resolved_dependencies"), RESOLVED);
    expect(cell.state).toBe("unknown");
    // A category with facts, whose search can't claim absence, is unknown for the rows it lacks.
    const partial = { ...cli, categories: { ...cli.categories, resolved_dependencies: { ...cli.categories.resolved_dependencies!, facts: cli.categories.resolved_dependencies!.facts.slice(1) } } };
    expect(missingCell(partial, definition("resolved_dependencies"), RESOLVED)).toEqual({ state: "unknown", reason: RESOLVED.unknown });
  });

  it("puts a consumed package that no manifest declares in a group without a manifest", () => {
    const consumed = cli.categories.packages_consumed!;
    const ghost = { ...consumed.facts[0]!, key: "ghost", value: { name: "ghost", internal: false } };
    const document = { ...cli, categories: { ...cli.categories, packages_consumed: { ...consumed, facts: [...consumed.facts, ghost] } } };
    const groups = dependencyGroups(document);
    expect(groups.at(-1)).toMatchObject({ manifest: null, rows: [{ name: "ghost", declared: null, resolved: null, consumed: ghost }] });
  });

  it("attaches each script's verification command, puts CI steps with their definition, and keeps other commands", () => {
    const { groups, ciSteps } = scriptGroups(storefront);
    const scripts = groups.find((group) => group.manifest === "package.json")!.rows;
    expect(scripts.map((row) => [row.name, row.verification ? (row.verification.value as { kinds: string[] }).kinds : null])).toEqual([
      ["build", ["build"]],
      ["start", null],
      ["test", ["test"]],
    ]);
    const steps = ciSteps.get(".github/workflows/ci.yml")!;
    expect(steps.map((step) => (step.value as { command: string }).command)).toEqual(["npm ci", "npm test"]);

    const commands = storefront.categories.verification_commands!;
    const make = { ...commands.facts[0]!, key: "Makefile#check", value: { command: "make check", context: { target: "check" }, kinds: ["test"], source: "Makefile" } };
    const document = { ...storefront, categories: { ...storefront.categories, verification_commands: { ...commands, facts: [...commands.facts, make] } } };
    expect(scriptGroups(document).groups.at(-1)).toMatchObject({ manifest: null, rows: [{ name: "Makefile#check", script: null, verification: make }] });
  });
});
