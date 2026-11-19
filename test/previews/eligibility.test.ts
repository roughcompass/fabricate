import { describe, expect, it } from "vitest";
import type { JsonObject } from "@repo-facts/contract";
import { type Condition, type ConditionId, type EligibilityInput, type ManifestRead, evaluateEligibility, installRootManifests, vitePackages } from "@/lib/previews/eligibility";
import { type PageRead, readPage } from "@/lib/previews/pages";
import type { FactDocument } from "@/lib/profiles/states";
import { analyzedFacts } from "../support/fact-documents";
import { FEDERATED_WORKSPACE, NEXT_APP, NPM_WORKSPACE, SCALA_SERVICE, TWO_LOCKFILES, type Tree, VITE_REACT_APP, offlineFederatedRemote, offlineSingleSpaBundle, offlineViteLibrary } from "../support/preview-trees";
import { manifest } from "../support/profiles";

/*
 * Eligibility (design decision 3): pure rules over the fact document the
 * pinned bundle produces for a committed tree, plus the committed
 * package.json of each install root.
 */

const NODE = ["18.20.4", "20.18.1", "22.11.0"];

/** The install-root manifests a preparation would read from +tree+. */
function manifestsOf(document: FactDocument, tree: Tree): Map<string, ManifestRead> {
  return new Map(
    installRootManifests(document).map((directory) => {
      const file = tree[directory === "." ? "package.json" : `${directory}/package.json`];
      return [directory, file === undefined ? { state: "missing" } : { state: "read", manifest: JSON.parse(file) as JsonObject }];
    }),
  );
}

/** Each Vite package's page in +tree+, as preparation looks for it through the snapshot reader. */
function pagesOf(document: FactDocument, tree: Tree): Map<string, PageRead> {
  return new Map(vitePackages(document).map((directory) => [directory, readPage(directory, { has: (file) => Object.hasOwn(tree, file), text: (file) => tree[file] ?? null })]));
}

async function decide(tree: Tree, options: Partial<EligibilityInput> = {}) {
  const document = await analyzedFacts(tree);
  return evaluateEligibility({ document, manifests: manifestsOf(document, tree), nodeVersions: NODE, pages: pagesOf(document, tree), ...options });
}

/** The page that makes the workspace's nested inspector tool a Vite app when a test gives it a build. */
const INSPECTOR_PAGE = { "tools/inspector/index.html": "<!doctype html><title>Inspector</title>\n" };

const condition = (conditions: readonly Condition[], id: ConditionId) => conditions.find((candidate) => candidate.condition === id)!;
const locations = (found: Condition) => found.facts.flatMap((fact) => [...fact.evidence, ...(fact.candidates ?? []).flatMap((candidate) => candidate.evidence)]).map((evidence) => evidence.location);

describe("preview eligibility", () => {
  it("qualifies a Vite React application, with what its build needs", async () => {
    const { packages, refusal } = await decide(VITE_REACT_APP);

    expect(refusal).toBeNull();
    expect(packages).toHaveLength(1);
    const [app] = packages;
    expect(app).toMatchObject({ directory: ".", manifest: "package.json", name: "orders-spa", qualifies: true });
    expect(app!.conditions.map((found) => [found.condition, found.passed])).toEqual([
      ["framework", true],
      ["build_tool", true],
      ["package_manager", true],
      ["node", true],
      ["build_script", true],
      ["page", true],
    ]);
    expect(app!.plan).toEqual({
      installRoot: ".",
      packageManager: { name: "pnpm", version: "9.1.0", lockfile: "pnpm-lock.yaml" },
      buildTool: "vite",
      buildScript: "tsc -b && vite build",
      node: { version: "22.11.0", ranges: [">=20.0.0"] },
      layout: "standalone",
      composition: null,
    });
    // Each condition carries the facts that decided it, with their evidence.
    expect(locations(condition(app!.conditions, "framework"))).toEqual(["package.json /dependencies/react"]);
    expect(locations(condition(app!.conditions, "package_manager"))).toEqual(expect.arrayContaining(["pnpm-lock.yaml", "package.json /packageManager"]));
  });

  it("refuses a Next.js application because it renders on a server", async () => {
    const { packages, refusal } = await decide(NEXT_APP);

    expect(packages.map((verdict) => verdict.qualifies)).toEqual([false]);
    const framework = condition(refusal!.conditions, "framework");
    expect(framework).toMatchObject({ package: ".", passed: false });
    expect(framework.reason).toBe("Next.js renders on a server. Previews need a client-rendered single-page application whose build produces static files.");
    expect(locations(framework)).toContain("package.json /dependencies/next");
    expect(condition(refusal!.conditions, "build_tool").reason).toMatch(/^No supported build tool applies to this package/);
  });

  it("refuses a Scala service, naming the missing framework and the input it couldn't read", async () => {
    const { packages, refusal } = await decide(SCALA_SERVICE);

    expect(packages).toEqual([]);
    expect(refusal!.reason).toBe("No package declares a browser framework");
    expect(refusal!.conditions).toHaveLength(1);
    const [framework] = refusal!.conditions;
    expect(framework).toMatchObject({ condition: "framework", package: null, passed: false });
    expect(framework!.reason).toMatch(/^No browser framework was found, and its frameworks couldn't be decided: build\.sbt could not be read or understood\./);
    expect(framework!.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "frameworks", key: null, state: "unknown", value: { complete: true, skipped: ["build.sbt"], skippedCount: 1 } }),
        expect.objectContaining({ category: "languages", key: "Scala" }),
      ]),
    );
  });

  it("refuses two lockfiles that disagree, naming each with its evidence", async () => {
    const { refusal } = await decide(TWO_LOCKFILES);

    const manager = condition(refusal!.conditions, "package_manager");
    expect(manager.reason).toBe("The package manager at the repository root conflicts: npm (package-lock.json) or yarn (yarn.lock).");
    expect(manager.facts).toEqual([expect.objectContaining({ category: "package_managers", key: ".", state: "conflicting" })]);
    expect(locations(manager)).toEqual(expect.arrayContaining(["package-lock.json", "yarn.lock"]));
    // Every other condition passed: the lockfiles alone refuse it.
    expect(refusal!.conditions.map((failed) => failed.condition)).toEqual(["package_manager"]);
  });

  describe("framework", () => {
    it("refuses a server framework even beside a browser one", async () => {
      const tree = { ...VITE_REACT_APP, "package.json": manifest({ ...JSON.parse(VITE_REACT_APP["package.json"]!), dependencies: { react: "^18.3.1", express: "^4.19.2" } }) };
      expect(condition((await decide(tree)).refusal!.conditions, "framework").reason).toMatch(/^Express renders on a server/);
    });

    it("refuses a package without a browser framework", async () => {
      const tree = { ...VITE_REACT_APP, "package.json": manifest({ ...JSON.parse(VITE_REACT_APP["package.json"]!), dependencies: { "left-pad": "1.3.0" } }) };
      expect(condition((await decide(tree)).refusal!.conditions, "framework").reason).toBe("No browser framework is declared in package.json. Previews need React, Preact, Vue, Angular, Svelte, Solid, or Lit.");
    });
  });

  describe("build tool", () => {
    it("refuses a package no supported tool builds, naming what it declares", async () => {
      const tree = { ...VITE_REACT_APP, "package.json": manifest({ ...JSON.parse(VITE_REACT_APP["package.json"]!), devDependencies: { typescript: "^5.5.0" } }) };
      delete (tree as Record<string, string>)["vite.config.ts"];
      expect(condition((await decide(tree)).refusal!.conditions, "build_tool").reason).toBe("No supported build tool applies to this package. It declares TypeScript compiler. Previews support Vite, webpack, Rspack, and Rsbuild.");
    });

    it("refuses two supported tools, since which one builds can't be decided", async () => {
      const tree = { ...VITE_REACT_APP, "package.json": manifest({ ...JSON.parse(VITE_REACT_APP["package.json"]!), devDependencies: { vite: "^5.4.0", webpack: "^5.90.0" } }) };
      expect(condition((await decide(tree)).refusal!.conditions, "build_tool").reason).toBe("Vite and webpack both apply to this package, so which one builds it can't be decided.");
    });
  });

  describe("package manager", () => {
    const withManifest = (fields: Record<string, unknown>, extra: Tree = {}, without: string[] = []) => {
      const tree: Record<string, string> = { ...VITE_REACT_APP, "package.json": manifest({ ...JSON.parse(VITE_REACT_APP["package.json"]!), ...fields }), ...extra };
      for (const file of without) delete tree[file];
      return tree;
    };

    it("refuses a declared manager whose lockfile disagrees", async () => {
      const tree = withManifest({}, { "package-lock.json": manifest({ name: "orders-spa", lockfileVersion: 3, packages: {} }) }, ["pnpm-lock.yaml"]);
      expect(condition((await decide(tree)).refusal!.conditions, "package_manager").reason).toMatch(/^The package manager at the repository root conflicts: npm \(package-lock\.json\) or pnpm \(package\.json\)/);
    });

    it("refuses an install root without a lockfile", async () => {
      const tree = withManifest({ packageManager: undefined }, {}, ["pnpm-lock.yaml"]);
      expect(condition((await decide(tree)).refusal!.conditions, "package_manager").reason).toBe("No lockfile applies to its install root, the repository root. Previews install from a lockfile without changing it.");
    });

    it("refuses a manager previews don't support", async () => {
      const tree = withManifest({ packageManager: undefined }, { "bun.lock": "{}\n" }, ["pnpm-lock.yaml"]);
      const { refusal } = await decide(tree);
      expect(condition(refusal!.conditions, "package_manager").reason).toBe("bun isn't a supported package manager. Previews support npm, pnpm, and Yarn.");
    });

    it("installs with the version the root declares, or the manager's own when none is declared", async () => {
      const declared = await decide(withManifest({ packageManager: "pnpm@9.1.0+sha512.0123456789abcdef" }));
      expect(declared.packages[0]!.plan!.packageManager).toEqual({ name: "pnpm", version: "9.1.0", lockfile: "pnpm-lock.yaml" });
      const undeclared = await decide(withManifest({ packageManager: undefined }));
      expect(undeclared.packages[0]!.plan!.packageManager).toEqual({ name: "pnpm", version: null, lockfile: "pnpm-lock.yaml" });
    });

    it("refuses a version declaration that isn't exact, or a root manifest that couldn't be read", async () => {
      const tree = withManifest({ packageManager: "pnpm@latest" });
      expect(condition((await decide(tree)).refusal!.conditions, "package_manager").reason).toBe('package.json declares packageManager "pnpm@latest", which isn\'t an exact pnpm version.');
      const unreadable = await decide(VITE_REACT_APP, { manifests: new Map([[".", { state: "unreadable", reason: "blob_too_large" }]]) });
      expect(condition(unreadable.refusal!.conditions, "package_manager").reason).toBe("Its package manager version at the repository root couldn't be decided: package.json couldn't be read (blob_too_large).");
    });
  });

  describe("Node", () => {
    it("selects the highest configured version that satisfies the declared range", async () => {
      const tree = { ...VITE_REACT_APP, ".nvmrc": "20\n" };
      const { packages } = await decide(tree);
      expect(packages[0]!.plan!.node).toEqual({ version: "20.18.1", ranges: [">=20.0.0 <21.0.0-0"] });
    });

    it("uses the highest configured version when the detector establishes there is no declaration", async () => {
      const tree = { ...VITE_REACT_APP, "package.json": manifest({ ...JSON.parse(VITE_REACT_APP["package.json"]!), engines: undefined }) };
      const { packages } = await decide(tree);
      expect(packages[0]!.plan!.node).toEqual({ version: "22.11.0", ranges: [] });
      expect(condition(packages[0]!.conditions, "node").reason).toBe("No Node version is declared, so the highest configured, 22.11.0, is used");
    });

    it("refuses when no configured version satisfies the range, or none is configured", async () => {
      const unsatisfied = await decide(VITE_REACT_APP, { nodeVersions: ["18.20.4"] });
      expect(condition(unsatisfied.refusal!.conditions, "node").reason).toBe("No configured Node version satisfies >=20.0.0. Configured: 18.20.4.");
      const unconfigured = await decide(VITE_REACT_APP, { nodeVersions: [] });
      expect(condition(unconfigured.refusal!.conditions, "node").reason).toBe("No Node versions are configured for previews (previews.nodeVersions).");
    });

    it("refuses declarations that conflict", async () => {
      const { refusal } = await decide({ ...VITE_REACT_APP, ".nvmrc": "18\n" });
      const node = condition(refusal!.conditions, "node");
      expect(node.reason).toMatch(/^Its Node declarations conflict: >=18\.0\.0 <19\.0\.0-0 \(\.nvmrc\) or >=20\.0\.0 \(package\.json\)/);
      expect(locations(node)).toEqual(expect.arrayContaining([".nvmrc:1", "package.json /engines/node"]));
    });

    it("treats missing analysis as undecided, not as no declaration", async () => {
      const document = await analyzedFacts(VITE_REACT_APP);
      const runtime = document.categories.runtime_requirements!;
      const blind: FactDocument = { ...document, categories: { ...document.categories, runtime_requirements: { ...runtime, state: "unknown", facts: [], search: { ...runtime.search, skipped: [".nvmrc"] } } } };
      const { refusal } = evaluateEligibility({ document: blind, manifests: manifestsOf(document, VITE_REACT_APP), nodeVersions: NODE, pages: pagesOf(document, VITE_REACT_APP) });
      expect(condition(refusal!.conditions, "node").reason).toBe("Its Node requirement couldn't be decided: .nvmrc could not be read or understood.");
    });
  });

  it("refuses a package without a build script", async () => {
    const tree = { ...VITE_REACT_APP, "package.json": manifest({ ...JSON.parse(VITE_REACT_APP["package.json"]!), scripts: { dev: "vite" } }) };
    expect(condition((await decide(tree)).refusal!.conditions, "build_script").reason).toBe("package.json declares no build script.");
  });

  describe("monorepos", () => {
    it("qualifies the one application of a workspace from its root lockfile, despite unrelated package signals", async () => {
      const { packages, refusal } = await decide(NPM_WORKSPACE);

      expect(refusal).toBeNull();
      expect(packages.filter((verdict) => verdict.qualifies).map((verdict) => verdict.directory)).toEqual(["packages/web"]);
      expect(packages.find((verdict) => verdict.directory === "packages/web")!.plan).toMatchObject({
        installRoot: ".",
        packageManager: { name: "npm", version: null, lockfile: "package-lock.json" },
        buildTool: "vite",
        buildScript: "vite build",
        node: { version: "22.11.0", ranges: [">=22.0.0 <23.0.0-0"] },
        layout: "standalone",
      });
      const failed = (directory: string) => packages.find((verdict) => verdict.directory === directory)!.conditions.filter((found) => !found.passed).map((found) => found.condition);
      // Each other package fails for its own reasons, without affecting the application.
      expect(failed(".")).toEqual(["framework", "build_tool"]);
      expect(failed("packages/api")).toEqual(["framework", "build_tool", "build_script"]);
      expect(failed("packages/ui")).toEqual(["build_tool"]);
      expect(failed("packages/legacy")).toEqual(["package_manager"]);
      expect(failed("tools/inspector")).toEqual(["build_tool", "build_script"]);
      expect(condition(packages.find((verdict) => verdict.directory === "packages/legacy")!.conditions, "package_manager").reason).toBe(
        "It has its own lockfile, but installs from the workspace at the repository root, so which one applies can't be decided.",
      );
    });

    it("installs a nested package outside the workspace from its own root", async () => {
      const tree = { ...NPM_WORKSPACE, ...INSPECTOR_PAGE, "tools/inspector/package.json": manifest({ name: "inspector", private: true, scripts: { build: "vite build" }, dependencies: { lit: "^3.1.0" }, devDependencies: { vite: "^5.4.0" } }) };
      const { packages } = await decide(tree);
      expect(packages.find((verdict) => verdict.directory === "tools/inspector")!.plan).toMatchObject({ installRoot: "tools/inspector", packageManager: { name: "pnpm", lockfile: "tools/inspector/pnpm-lock.yaml" } });
    });

    it("applies the workspace's Node declarations to its members, and not to packages outside it", async () => {
      const tree: Record<string, string> = {
        ...NPM_WORKSPACE,
        "packages/api/package.json": manifest({ name: "@acme/orders-api", engines: { node: "20" }, dependencies: { express: "^4.19.2" } }),
        ...INSPECTOR_PAGE,
        "tools/inspector/package.json": manifest({ name: "inspector", private: true, scripts: { build: "vite build" }, dependencies: { lit: "^3.1.0" }, devDependencies: { vite: "^5.4.0" } }),
      };
      delete tree[".nvmrc"];
      const { packages } = await decide(tree);
      // The workspace install includes the API, so its declaration constrains the application.
      expect(packages.find((verdict) => verdict.directory === "packages/web")!.plan!.node).toEqual({ version: "20.18.1", ranges: [">=20.0.0 <21.0.0-0"] });
      expect(packages.find((verdict) => verdict.directory === "tools/inspector")!.plan!.node).toEqual({ version: "22.11.0", ranges: [] });
    });

    it("qualifies every application of a workspace that holds several, with their layouts", async () => {
      const { packages, refusal } = await decide(FEDERATED_WORKSPACE);

      expect(refusal).toBeNull();
      const qualifying = packages.filter((verdict) => verdict.qualifies);
      expect(qualifying.map((verdict) => [verdict.directory, verdict.plan!.installRoot, verdict.plan!.buildTool, verdict.plan!.layout])).toEqual([
        ["apps/admin", ".", "rspack", "module_federation"],
        ["apps/billing", ".", "rspack", "module_federation"],
        ["apps/shell", ".", "vite", "standalone"],
      ]);
      expect(qualifying[0]!.plan!.composition).toMatchObject({ mechanism: "module-federation", exposes: ["./Admin"] });
      expect(qualifying[0]!.plan!.packageManager).toEqual({ name: "pnpm", version: "9.1.0", lockfile: "pnpm-lock.yaml" });
    });

    it("qualifies microfrontends built by other tools than Vite, whose output is checked for a page once built, and notes their kind", async () => {
      const remote = await decide(offlineFederatedRemote());
      const [admin] = remote.packages.filter((verdict) => verdict.qualifies);
      expect(remote.packages.filter((verdict) => verdict.qualifies)).toHaveLength(1);
      expect(admin!.plan).toMatchObject({ buildTool: "rspack", layout: "module_federation", packageManager: { name: "npm", lockfile: "package-lock.json" } });
      expect(admin!.plan!.composition).toMatchObject({ mechanism: "module-federation", name: { kind: "literal", value: "fixtureAdmin" }, exposes: ["./Footer", "./Header"] });
      expect(condition(admin!.conditions, "page")).toMatchObject({ passed: true, reason: "Its build must emit index.html, which is checked once it has run" });

      const bundle = await decide(offlineSingleSpaBundle());
      const [orders] = bundle.packages.filter((verdict) => verdict.qualifies);
      expect(bundle.packages.filter((verdict) => verdict.qualifies)).toHaveLength(1);
      expect(orders!.plan).toMatchObject({ buildTool: "webpack", layout: "single_spa", composition: { mechanism: "single-spa", role: "application" } });
    });

    it("keeps only the package's own evidence of a tool reported for the whole repository", async () => {
      const { packages } = await decide(FEDERATED_WORKSPACE);
      const admin = condition(packages.find((verdict) => verdict.directory === "apps/admin")!.conditions, "build_tool");
      // Billing's two pieces of evidence for Rspack are counted, not copied.
      expect(admin.facts).toEqual([expect.objectContaining({ category: "build_tools", key: "rspack", elsewhere: 2 })]);
      expect(locations(admin).sort()).toEqual(["apps/admin/package.json /devDependencies/@rspack/cli", "apps/admin/package.json /devDependencies/@rspack/core", "apps/admin/rspack.config.cjs"]);
    });

    const inspectorTree = (nvmrc: boolean) => {
      const tree: Record<string, string> = {
        ...NPM_WORKSPACE,
        "packages/api/package.json": manifest({ name: "@acme/orders-api", engines: { node: "20" }, dependencies: { express: "^4.19.2" } }),
        ...INSPECTOR_PAGE,
        "tools/inspector/package.json": manifest({ name: "inspector", private: true, engines: { node: ">=18" }, scripts: { build: "vite build" }, dependencies: { lit: "^3.1.0" }, devDependencies: { vite: "^5.4.0" } }),
      };
      if (!nvmrc) delete tree[".nvmrc"];
      return tree;
    };

    it("decides from the conflicting Node declarations that apply to each package", async () => {
      // The repository's .nvmrc (22) and the API's engines (20) conflict.
      const { packages } = await decide(inspectorTree(true));
      // The workspace install includes the API, so its declaration conflicts with the application's.
      expect(condition(packages.find((verdict) => verdict.directory === "packages/web")!.conditions, "node").reason).toBe(
        "Its Node declarations conflict: >=20.0.0 <21.0.0-0 (packages/api/package.json) or >=22.0.0 <23.0.0-0 (.nvmrc).",
      );
      // The inspector installs on its own: only the .nvmrc and its own engines apply, and they agree.
      expect(packages.find((verdict) => verdict.directory === "tools/inspector")!.plan!.node).toEqual({ version: "22.11.0", ranges: [">=22.0.0 <23.0.0-0", ">=18.0.0"] });
    });

    it("bounds a package's Node version by a range the profile merged with packages its install doesn't include", async () => {
      // The API's engines (20) and the inspector's (>=18) agree, so the profile merged them into one range.
      const { packages } = await decide(inspectorTree(false));
      const inspector = packages.find((verdict) => verdict.directory === "tools/inspector")!;
      expect(inspector.plan!.node).toEqual({ version: "20.18.1", ranges: [">=20.0.0 <21.0.0-0"] });
      const node = condition(inspector.conditions, "node");
      expect(node.reason).toBe("Node 20.18.1 satisfies >=20.0.0 <21.0.0-0, the range the profile merged from its declarations and ones from packages its install doesn't include, such as packages/api/package.json");
      expect(node.facts[0]).toMatchObject({ elsewhere: 1 });
      expect(node.facts[0]!.evidence.map((evidence) => evidence.location)).toEqual(["tools/inspector/package.json /engines/node"]);

      // When no configured version is in the merged range, the range that applies to it alone can't be separated.
      const refused = await decide(inspectorTree(false), { nodeVersions: ["22.11.0"] });
      expect(condition(refused.packages.find((verdict) => verdict.directory === "tools/inspector")!.conditions, "node").reason).toMatch(/^Its Node requirement couldn't be decided: the profile merges the Node declarations that apply to it with ones from packages its install doesn't include, such as packages\/api\/package\.json, and no configured version satisfies them all\.$/);
    });

    it("isn't made undecided by other ecosystems' manifests it can't read", async () => {
      const tree = { ...VITE_REACT_APP, "services/ledger/go.mod": "module example.com/ledger\n\ngo 1.22\n", "tools/pyproject.toml": '[project]\nname = "tools"\n' };
      const document = await analyzedFacts(tree);
      expect(document.categories.runtime_requirements!.search.skipped).toEqual(expect.arrayContaining(["services/ledger/go.mod"]));
      expect(evaluateEligibility({ document, manifests: manifestsOf(document, tree), nodeVersions: NODE, pages: pagesOf(document, tree) }).packages[0]!.qualifies).toBe(true);
    });

    it("reads only the install roots' manifests", async () => {
      expect(installRootManifests(await analyzedFacts(NPM_WORKSPACE))).toEqual([".", "tools/inspector"]);
      expect(installRootManifests(await analyzedFacts(FEDERATED_WORKSPACE))).toEqual(["."]);
    });
  });

  describe("pages", () => {
    it("refuses a Vite single-spa library with no committed page before building, naming the page and the facts that make it Vite's", async () => {
      const { packages, refusal } = await decide(offlineViteLibrary());
      const [library] = packages.filter((verdict) => verdict.directory === ".");
      expect(library!.qualifies).toBe(false);
      expect(library!.plan).toBeNull();
      expect(library!.conditions.filter((found) => !found.passed).map((found) => found.condition)).toEqual(["page"]);
      const page = condition(refusal!.conditions, "page");
      expect(page.reason).toBe("No index.html is committed at index.html, the page Vite builds from. Previews need a page that loads the application on its own.");
      expect(locations(page)).toEqual(expect.arrayContaining(["package.json /devDependencies/vite", "vite.config.js"]));
    });

    it("qualifies a Vite app whose page is committed, in its own directory or a workspace member's", async () => {
      const [app] = (await decide(VITE_REACT_APP)).packages;
      expect(condition(app!.conditions, "page")).toMatchObject({ passed: true, reason: "Vite builds its page from index.html" });
      const web = (await decide(NPM_WORKSPACE)).packages.find((verdict) => verdict.directory === "packages/web")!;
      expect(web.qualifies).toBe(true);
      expect(condition(web.conditions, "page").reason).toBe("Vite builds its page from packages/web/index.html");

      const { [`packages/web/index.html`]: _page, ...without } = NPM_WORKSPACE;
      const refused = (await decide(without)).packages.find((verdict) => verdict.directory === "packages/web")!;
      expect(condition(refused.conditions, "page").reason).toBe("No index.html is committed at packages/web/index.html, the page Vite builds from. Previews need a page that loads the application on its own.");
    });

    describe("the root Vite reads", () => {
      const files = (tree: Record<string, string>) => ({ has: (file: string) => Object.hasOwn(tree, file), text: (file: string) => tree[file] ?? null });

      it.each([
        ["a string", 'export default defineConfig({ root: "src", plugins: [react()] });\n'],
        ["a quoted key and single quotes", "export default { 'root': './src/' };\n"],
        ["path.resolve of __dirname", 'import path from "node:path";\nexport default { root: path.resolve(__dirname, "src") };\n'],
        ["join of __dirname", "export default { root: join(__dirname, 'src') };\n"],
      ])("reads a root named as %s", (_label, config) => {
        expect(readPage("apps/web", files({ "apps/web/vite.config.ts": config, "apps/web/src/index.html": "<!doctype html>" }))).toEqual({ state: "found", page: "apps/web/src/index.html", config: "apps/web/vite.config.ts" });
        expect(readPage("apps/web", files({ "apps/web/vite.config.ts": config, "apps/web/index.html": "<!doctype html>" }))).toEqual({ state: "missing", page: "apps/web/src/index.html", config: "apps/web/vite.config.ts" });
      });

      it("uses the package's directory without a root, and the configuration Vite loads first", () => {
        expect(readPage(".", files({ "vite.config.ts": "export default { build: { outDir: 'out' } };\n", "index.html": "" }))).toEqual({ state: "found", page: "index.html", config: null });
        expect(readPage(".", files({ "vite.config.ts": "export default { root: 'src' };\n", "vite.config.js": "export default { root: __dirname };\n", "index.html": "" }))).toEqual({ state: "found", page: "index.html", config: null });
        expect(readPage(".", files({ "index.html": "" }))).toEqual({ state: "found", page: "index.html", config: null });
        expect(readPage("lib", files({}))).toEqual({ state: "missing", page: "lib/index.html", config: null });
        // A key that merely ends in "root" isn't Vite's root.
        expect(readPage(".", files({ "vite.config.ts": "export default { server: { fs: { allow: [searchForWorkspaceRoot(process.cwd())] } }, cacheRoot: 'x' };\n", "index.html": "" }))).toMatchObject({ state: "found", page: "index.html" });
      });

      it("can't decide a root set in code, several roots, or one outside the repository, or a configuration it can't read", () => {
        const undecided = (config: string | null) => readPage("web", { has: (file) => file === "web/vite.config.ts", text: () => config });
        expect(undecided("export default { root: resolve(here, 'src') };\n")).toEqual({ state: "undecided", config: "web/vite.config.ts", reason: "web/vite.config.ts sets Vite's root in code, so where its page is can't be read" });
        expect(undecided("export default { root: 'src', test: { root: 'tests' } };\n")).toEqual({ state: "undecided", config: "web/vite.config.ts", reason: "web/vite.config.ts names several roots, src and tests, so which one Vite reads can't be decided" });
        expect(undecided("export default { root: '../../elsewhere' };\n")).toMatchObject({ state: "undecided", reason: "web/vite.config.ts names a root outside the repository" });
        expect(undecided("export default { root: '/srv/app' };\n")).toMatchObject({ state: "undecided", reason: "web/vite.config.ts names a root outside the repository" });
        expect(undecided(null)).toEqual({ state: "undecided", config: "web/vite.config.ts", reason: "web/vite.config.ts couldn't be read" });
      });
    });
  });
});
