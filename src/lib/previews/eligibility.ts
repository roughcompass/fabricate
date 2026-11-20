import path from "node:path";
import semver from "semver";
import type { JsonObject, JsonValue } from "@repo-facts/contract";
import type { ArtifactLayout } from "@/lib/db/schema";
// Types only: the profile view module pulls in UI components the worker must not bundle.
import type { Fact, FactDocument } from "@/lib/profiles/states";
import { type BundlePageRead, type Bundler, PAGE_FILE, type PageRead } from "./pages";
import { type DecidingFact, type Membership, ProfiledRepository, categoryOf, manifestOfFact, manifestPath, objectValue, paths, place } from "./profiled-repository";
import { list } from "./wording";
import { SURVEYOR_RELEASE_LABEL } from "@/lib/product";

export type { DecidingFact } from "./profiled-repository";
export { manifestPath } from "./profiled-repository";

/**
 * Which packages of one commit can be previewed (design decision 3), decided
 * by pure functions over the commit's fact document and the committed
 * manifests of install roots, like evaluations. A package qualifies only when
 * every condition the spec lists passes for it: a browser framework, a
 * supported build tool, one package manager and lockfile at its install
 * root, a satisfiable Node requirement or none, and a build script.
 *
 * Facts are attributed to a package by manifest identity and evidence path,
 * never by repository-wide category presence, so a signal in an unrelated
 * package neither qualifies nor disqualifies it. A deciding fact that is
 * unknown or conflicting for the package refuses it, naming why.
 *
 * A Vite package also needs its page, `index.html`, committed at the root its
 * build reads, since Vite builds no page without one; preparation reads that
 * through the snapshot reader (pages.ts). A single-spa application that
 * webpack or Rspack builds needs an HTML plugin in its configuration or its
 * dependencies, or an HTML file it commits, since its build otherwise emits
 * only its bundle; preparation reads its configuration the same way. Other
 * builds are checked after they run, when their output must contain
 * `index.html` (output.ts).
 */

export const CONDITIONS = ["framework", "build_tool", "package_manager", "node", "build_script", "page"] as const;
export type ConditionId = (typeof CONDITIONS)[number];

/** Browser frameworks a preview can run (design decision 3). */
const BROWSER_FRAMEWORKS: Readonly<Record<string, string>> = { react: "React", preact: "Preact", vue: "Vue", angular: "Angular", svelte: "Svelte", solid: "Solid", lit: "Lit" };
/** Frameworks that serve requests, and meta-frameworks whose static export the profile doesn't establish. */
const SERVER_FRAMEWORKS = new Set(["express", "fastify", "koa", "hono", "nestjs", "next", "remix", "nuxt", "sveltekit", "astro", "gatsby"]);
/** Build tools with a preview base-path adapter (design decision 5). */
export const BUILD_TOOLS = ["vite", "webpack", "rspack", "rsbuild"] as const;
export type BuildTool = (typeof BUILD_TOOLS)[number];
const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn"] as const;
type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/*
 * Which skipped inputs could change a decision. A category lists every input
 * it couldn't read, including other ecosystems' manifests it doesn't analyze,
 * such as go.mod or a .csproj; those can't declare a JavaScript package's
 * workspace, lockfile, build tool, or Node version.
 */
const LOCKFILE_INPUTS = new Set(["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "deno.lock"]);
const TOOL_CONFIG = /^(?:package\.json|(?:vite|webpack|rspack|rsbuild)\.config\.[cm]?[jt]s)$/;
const NODE_INPUTS = new Set(["package.json", ".nvmrc", ".node-version", ".tool-versions", "Dockerfile", "Jenkinsfile", ".gitlab-ci.yml", "mise.toml", ".mise.toml", ".prototools"]);
const declaresNode = (input: string) => {
  const name = path.posix.basename(input);
  return NODE_INPUTS.has(name) || name.endsWith(".Dockerfile") || input.startsWith(".github/workflows/");
};

export interface Condition {
  condition: ConditionId;
  passed: boolean;
  reason: string;
  facts: DecidingFact[];
}

/** What a build of a qualifying package needs. */
export interface BuildPlan {
  /** Where dependencies install: the package itself, or the workspace root it belongs to. */
  installRoot: string;
  packageManager: { name: PackageManager; version: string | null; lockfile: string };
  buildTool: BuildTool;
  buildScript: string;
  /** The Node version to build with, and the declared ranges it satisfies; none when nothing is declared. */
  node: { version: string; ranges: string[] };
  /**
   * What kind of package it is, for display: a Module Federation remote or
   * single-spa application previews through its own page like any other
   * application (design decision 7), so it never changes how it's served.
   */
  layout: ArtifactLayout;
  /** The Module Federation or single-spa fact that decided the layout, if any. */
  composition: JsonValue;
}

export interface PackageVerdict {
  /** The package's directory, `.` for the repository root. */
  directory: string;
  manifest: string;
  name: string | null;
  qualifies: boolean;
  conditions: Condition[];
  plan: BuildPlan | null;
}

export interface Refusal {
  reason: string;
  /** Each failed condition, with the package it failed for, or null when no package exists. */
  conditions: (Condition & { package: string | null })[];
}

export interface Eligibility {
  packages: PackageVerdict[];
  refusal: Refusal | null;
}

/** A committed manifest read through the snapshot reader. */
export type ManifestRead = { state: "read"; manifest: JsonObject } | { state: "missing" } | { state: "unreadable"; reason: string };

export interface EligibilityInput {
  document: FactDocument;
  /** Committed package.json of each install root, by directory (see installRootManifests). */
  manifests: ReadonlyMap<string, ManifestRead>;
  /** Configured Node versions, the keys of previews.nodeVersions. */
  nodeVersions: readonly string[];
  /** Each Vite package's page as the commit has it, by directory (see vitePackages and readPage). */
  pages: ReadonlyMap<string, PageRead>;
  /** Whether each single-spa bundle can emit a page, by directory (see bundlePackages and readBundlePage). */
  bundles: ReadonlyMap<string, BundlePageRead>;
}

/** Decides every package of the commit, and the refusal when none qualifies. */
export function evaluateEligibility(input: EligibilityInput): Eligibility {
  const repository = new ProfiledRepository(input.document);
  const packages = repository.packages.map((directory) => evaluatePackage(repository, directory, input));
  if (packages.some((verdict) => verdict.qualifies)) return { packages, refusal: null };
  if (packages.length === 0) return { packages, refusal: { reason: "No package declares a browser framework", conditions: [{ ...noPackage(repository), package: null }] } };
  return {
    packages,
    refusal: { reason: "No package qualifies for a preview", conditions: packages.flatMap((verdict) => verdict.conditions.filter((condition) => !condition.passed).map((condition) => ({ ...condition, package: verdict.directory }))) },
  };
}

/** What a package is built with, as an application's card and filters name it (add-applications, design decision 9). */
export interface PackageTraits {
  /** Its browser frameworks, such as React, when its framework condition passed. */
  frameworks: string[];
  /** Its build tool, such as Vite, when one was decided. */
  buildTool: string | null;
  /** Its package manager, such as pnpm, when one was decided. */
  packageManager: string | null;
}

const BUILD_TOOL_LABELS: Readonly<Record<BuildTool, string>> = { vite: "Vite", webpack: "webpack", rspack: "Rspack", rsbuild: "Rsbuild" };
const PACKAGE_MANAGER_LABELS: Readonly<Record<PackageManager, string>> = { npm: "npm", pnpm: "pnpm", yarn: "Yarn" };

/** A verdict's traits: from its build plan when it qualifies, else from the conditions that passed. */
export function packageTraits(verdict: PackageVerdict): PackageTraits {
  const passed = (id: ConditionId) => verdict.conditions.find((condition) => condition.condition === id && condition.passed);
  const value = (fact: DecidingFact) => (fact.value && typeof fact.value === "object" && !Array.isArray(fact.value) ? (fact.value as JsonObject) : {});
  const ids = (passed("framework")?.facts ?? []).filter((fact) => fact.category === "frameworks").map((fact) => String(value(fact).id ?? fact.key?.split("#")[1] ?? ""));
  const tool = passed("build_tool")?.facts.find((fact) => fact.category === "build_tools");
  return {
    frameworks: [...new Set(ids.filter((id) => id in BROWSER_FRAMEWORKS).map((id) => BROWSER_FRAMEWORKS[id]!))],
    buildTool: verdict.plan ? BUILD_TOOL_LABELS[verdict.plan.buildTool] : tool ? String(value(tool).label ?? value(tool).id ?? tool.key) : null,
    packageManager: verdict.plan ? PACKAGE_MANAGER_LABELS[verdict.plan.packageManager.name] : null,
  };
}

/** The directories whose committed package.json evaluation reads: every package's install root. */
export function installRootManifests(document: FactDocument): string[] {
  const repository = new ProfiledRepository(document);
  return [...new Set(repository.packages.map((directory) => repository.membership(directory).root ?? directory))].sort();
}

function evaluatePackage(repository: ProfiledRepository, directory: string, input: EligibilityInput): PackageVerdict {
  const membership = repository.membership(directory);
  const installRoot = membership.root ?? directory;
  const framework = frameworkCondition(repository, directory);
  const tool = buildToolCondition(repository, directory);
  const manager = packageManagerCondition(repository, directory, membership, input.manifests);
  const node = nodeCondition(repository, directory, installRoot, input.nodeVersions);
  const script = buildScriptCondition(repository, directory);
  const page = pageCondition(repository, directory, tool, input);
  const conditions = [framework.condition, tool.condition, manager.condition, node.condition, script.condition, page];
  const qualifies = conditions.every((condition) => condition.passed);
  const plan =
    qualifies && tool.tool && manager.plan && node.plan && script.command !== null
      ? { installRoot, packageManager: manager.plan, buildTool: tool.tool, buildScript: script.command, node: node.plan, ...layoutOf(repository, directory) }
      : null;
  return { directory, manifest: manifestPath(directory), name: repository.packageName(directory), qualifies: plan !== null, conditions, plan };
}

// -- Conditions ---------------------------------------------------------------

function frameworkCondition(repository: ProfiledRepository, directory: string): { condition: Condition } {
  const manifest = manifestPath(directory);
  const facts = repository.facts("frameworks").filter((fact) => manifestOfFact(fact) === manifest);
  const deciding = facts.map((fact) => repository.decidingFact("frameworks", fact));
  const unknown = repository.unknownReason("frameworks", (input) => input === manifest);
  const server = facts.filter((fact) => SERVER_FRAMEWORKS.has(frameworkId(fact)));
  const browser = facts.filter((fact) => frameworkId(fact) in BROWSER_FRAMEWORKS);
  const fail = (reason: string, extra: DecidingFact[] = []) => ({ condition: { condition: "framework" as const, passed: false, reason, facts: [...deciding, ...extra] } });

  if (server.length) {
    return fail(`${list(server.map(frameworkLabel))} ${server.length > 1 ? "render" : "renders"} on a server. Previews need a client-rendered single-page application whose build produces static files.`);
  }
  if (browser.length) return { condition: { condition: "framework", passed: true, reason: `${list(browser.map(frameworkLabel))} ${browser.length > 1 ? "run" : "runs"} in the browser`, facts: deciding } };
  if (unknown) return fail(`Its frameworks couldn't be decided: ${unknown}`, [repository.categoryFact("frameworks")]);
  return fail(`No browser framework is declared in ${manifest}. Previews need ${list(Object.values(BROWSER_FRAMEWORKS), "or")}.`);
}

function buildToolCondition(repository: ProfiledRepository, directory: string): { condition: Condition; tool: BuildTool | null } {
  const applicable = repository.facts("build_tools").filter((fact) => fact.evidence.some((id) => repository.owner(repository.evidencePath(id)) === directory));
  const supported = applicable.filter((fact) => (BUILD_TOOLS as readonly string[]).includes(toolId(fact)));
  // A tool is reported once for the whole repository, so only this package's evidence is kept.
  const owned = (input: string) => repository.owner(input) === directory;
  const deciding = applicable.map((fact) => repository.decidingFact("build_tools", fact, owned));
  const fail = (reason: string, extra: DecidingFact[] = []) => ({ condition: { condition: "build_tool" as const, passed: false, reason, facts: [...deciding, ...extra] }, tool: null });

  if (supported.length === 1) return { condition: { condition: "build_tool", passed: true, reason: `Builds with ${toolLabel(supported[0]!)}`, facts: deciding }, tool: toolId(supported[0]!) as BuildTool };
  if (supported.length > 1) return fail(`${list(supported.map(toolLabel))} ${supported.length === 2 ? "both" : "all"} apply to this package, so which one builds it can't be decided.`);
  const relevant = (input: string) => owned(input) && TOOL_CONFIG.test(path.posix.basename(input));
  const unknown = repository.unknownReason("build_tools", relevant);
  if (unknown) return fail(`Its build tools couldn't be decided: ${unknown}`, [repository.categoryFact("build_tools", relevant)]);
  const found = applicable.length ? ` It declares ${list(applicable.map(toolLabel))}.` : "";
  return fail(`No supported build tool applies to this package.${found} Previews support Vite, webpack, Rspack, and Rsbuild.`);
}

function packageManagerCondition(repository: ProfiledRepository, directory: string, membership: Membership, manifests: ReadonlyMap<string, ManifestRead>): { condition: Condition; plan: BuildPlan["packageManager"] | null } {
  const fail = (reason: string, facts: DecidingFact[]) => ({ condition: { condition: "package_manager" as const, passed: false, reason, facts }, plan: null });
  if (membership.unknown) return fail(`Whether it belongs to a workspace couldn't be decided: ${membership.unknown}`, membership.facts);

  const root = membership.root ?? directory;
  const at = place(root);
  const managers = repository.facts("package_managers");
  const fact = managers.find((candidate) => candidate.key === root);
  const facts = [...membership.facts, ...(fact ? [repository.decidingFact("package_managers", fact)] : [])];

  // A workspace member installs from its root, so a lockfile of its own leaves two that could apply.
  const own = membership.root !== null && membership.root !== directory ? managers.find((candidate) => candidate.key === directory) : undefined;
  if (own) {
    return fail(`It has its own lockfile, but installs from the workspace at ${at}, so which one applies can't be decided.`, [...facts, repository.decidingFact("package_managers", own)]);
  }
  if (!fact) {
    const relevant = (input: string) => path.posix.dirname(input) === root && LOCKFILE_INPUTS.has(path.posix.basename(input));
    const unknown = repository.unknownReason("package_managers", relevant);
    if (unknown) return fail(`Its package manager at ${at} couldn't be decided: ${unknown}`, [...facts, repository.categoryFact("package_managers", relevant)]);
    return fail(`No lockfile applies to its install root, ${at}. Previews install from a lockfile without changing it.`, facts);
  }
  if (fact.state === "conflicting") {
    const named = (fact.candidates ?? []).map((candidate) => `${String(candidate.value)} (${paths(candidate.evidence.map((id) => repository.evidencePath(id)), ", ")})`);
    return fail(`The package manager at ${at} conflicts: ${list(named, "or")}.`, facts);
  }
  if (fact.state === "unknown" || typeof fact.value !== "string") return fail(`Its package manager at ${at} couldn't be decided.`, facts);
  const name = fact.value;
  if (!(PACKAGE_MANAGERS as readonly string[]).includes(name)) return fail(`${name} isn't a supported package manager. Previews support npm, pnpm, and Yarn.`, facts);
  const lockfiles = [...new Set(fact.evidence.filter((id) => repository.evidenceRule(id) === "lockfile.package-manager").map((id) => repository.evidencePath(id)))];
  if (lockfiles.length !== 1) return fail(lockfiles.length ? `Several lockfiles apply at ${at}: ${paths(lockfiles)}.` : `${name} is declared at ${at}, but no lockfile is committed there. Previews install from a lockfile without changing it.`, facts);

  // The version comes from the root's own packageManager declaration, not from a resolved dependency.
  const read = manifests.get(root) ?? { state: "unreadable", reason: "it wasn't read" };
  if (read.state === "unreadable") return fail(`Its package manager version at ${at} couldn't be decided: ${manifestPath(root)} couldn't be read (${read.reason}).`, facts);
  const declared = read.state === "read" && typeof read.manifest.packageManager === "string" ? read.manifest.packageManager : null;
  let version: string | null = null;
  if (declared !== null) {
    const match = /^(npm|pnpm|yarn)@([^+]+)(?:\+.*)?$/.exec(declared.trim());
    if (!match || match[1] !== name || !semver.valid(match[2]!)) return fail(`${manifestPath(root)} declares packageManager ${JSON.stringify(declared)}, which isn't an exact ${name} version.`, facts);
    version = semver.valid(match[2]!);
  }
  const plan = { name: name as PackageManager, version, lockfile: lockfiles[0]! };
  return { condition: { condition: "package_manager", passed: true, reason: `Installs with ${name}${version ? ` ${version}` : ""} from ${lockfiles[0]} at ${at}`, facts }, plan };
}

function nodeCondition(repository: ProfiledRepository, directory: string, installRoot: string, configured: readonly string[]): { condition: Condition; plan: BuildPlan["node"] | null } {
  const category = categoryOf(repository.document, "runtime_requirements");
  const scope = repository.nodeScope(directory, installRoot);
  const applicable = (input: string) => {
    const owner = repository.owner(input);
    return owner === null || scope.has(owner);
  };
  const relevant = (input: string) => applicable(input) && declaresNode(input);
  const fail = (reason: string, facts: DecidingFact[]) => ({ condition: { condition: "node" as const, passed: false, reason, facts }, plan: null });
  if (!category) return fail(`Its Node requirement couldn't be decided: ${SURVEYOR_RELEASE_LABEL} ${repository.document.detector_release} doesn't report runtime requirements.`, [repository.categoryFact("runtime_requirements")]);

  const skipped = category.search.skipped.filter(relevant);
  const missingAnalysis = !category.search.complete || skipped.length > 0;
  const missingReason = skipped.length ? `${paths(skipped)} could not be read or understood` : "its search was incomplete";
  const fact = category.facts.find((candidate) => candidate.key === "node");
  const facts = fact ? [repository.decidingFact("runtime_requirements", fact, applicable)] : [repository.categoryFact("runtime_requirements", relevant)];
  const choose = (ranges: string[]) => {
    const selected = selectNode(configured, ranges);
    if (selected.version === null) return fail(selected.reason, facts);
    return { condition: { condition: "node" as const, passed: true, reason: selected.reason, facts }, plan: { version: selected.version, ranges } };
  };
  // Missing analysis is not the same as no declaration.
  const undeclared = () => (missingAnalysis ? fail(`Its Node requirement couldn't be decided: ${missingReason}.`, facts) : choose([]));
  const rangeOf = (value: JsonValue) => {
    const range = value && typeof value === "object" && !Array.isArray(value) && typeof value.range === "string" ? semver.validRange(value.range) : null;
    return range;
  };

  if (!fact) return undeclared();
  if (missingAnalysis) return fail(`Its Node requirement couldn't be decided: ${missingReason}.`, facts);
  if (fact.state === "conflicting") {
    // The repository's declarations conflict; the ones that apply to this package may still agree.
    const candidates = (fact.candidates ?? []).filter((candidate) => candidate.evidence.some((id) => applicable(repository.evidencePath(id))));
    if (candidates.length === 0) return undeclared();
    const ranges = candidates.map((candidate) => rangeOf(candidate.value));
    if (ranges.some((range) => range === null)) return fail("Its Node requirement couldn't be decided: a declared range isn't valid.", facts);
    const valid = ranges as string[];
    if (valid.every((range) => valid.every((other) => semver.intersects(range, other)))) return choose(valid);
    const named = candidates.map((candidate, index) => `${valid[index]} (${paths(candidate.evidence.map((id) => repository.evidencePath(id)).filter(applicable), ", ")})`);
    return fail(`Its Node declarations conflict: ${list(named, "or")}.`, facts);
  }
  if (fact.state === "unknown") return fail("Its Node requirement couldn't be decided.", facts);
  const declared = fact.evidence.map((id) => repository.evidencePath(id));
  if (declared.every((input) => !applicable(input))) return undeclared();
  const range = rangeOf(fact.value);
  if (!range) return fail("Its Node requirement couldn't be decided: the declared range isn't valid.", facts);
  if (declared.every(applicable)) return choose([range]);
  // The profile merged these declarations with other packages' into one range that satisfies them all, so
  // a version in it satisfies the ones that apply here. It's only a bound: when no configured version is
  // in it, the range that applies to this package alone can't be separated.
  const others = paths(declared.filter((input) => !applicable(input)));
  const chosen = choose([range]);
  if (!chosen.plan) return fail(`Its Node requirement couldn't be decided: the profile merges the Node declarations that apply to it with ones from packages its install doesn't include, such as ${others}, and no configured version satisfies them all.`, facts);
  return { ...chosen, condition: { ...chosen.condition, reason: `${chosen.condition.reason}, the range the profile merged from its declarations and ones from packages its install doesn't include, such as ${others}` } };
}

/**
 * The highest configured Node version that satisfies every one of +ranges+,
 * or why none does (design decision 4, step 2). Preparation decides with it,
 * and a build decides again under the settings it runs with, so both apply
 * one rule.
 */
export function selectNode(configured: readonly string[], ranges: readonly string[]): { version: string; reason: string } | { version: null; reason: string } {
  const sorted = [...configured].sort(semver.rcompare);
  if (sorted.length === 0) return { version: null, reason: "No Node versions are configured for previews (previews.nodeVersions)." };
  const version = sorted.find((candidate) => ranges.every((range) => semver.satisfies(candidate, range)));
  const wanted = list(ranges);
  if (!version) return { version: null, reason: `No configured Node version satisfies ${wanted}. Configured: ${sorted.join(", ")}.` };
  return { version, reason: ranges.length === 0 ? `No Node version is declared, so the highest configured, ${version}, is used` : `Node ${version} satisfies ${wanted}` };
}

function buildScriptCondition(repository: ProfiledRepository, directory: string): { condition: Condition; command: string | null } {
  const manifest = manifestPath(directory);
  const fact = repository.facts("scripts").find((candidate) => manifestOfFact(candidate) === manifest && objectValue(candidate)?.name === "build");
  if (fact && fact.state !== "conflicting" && typeof objectValue(fact)?.command === "string") {
    const command = objectValue(fact)!.command as string;
    return { condition: { condition: "build_script", passed: true, reason: `Runs its build script: ${command}`, facts: [repository.decidingFact("scripts", fact)] }, command };
  }
  const unknown = repository.unknownReason("scripts", (input) => input === manifest);
  const facts = fact ? [repository.decidingFact("scripts", fact)] : [repository.categoryFact("scripts")];
  const reason = unknown ? `Its scripts couldn't be decided: ${unknown}` : `${manifest} declares no build script.`;
  return { condition: { condition: "build_script", passed: false, reason, facts }, command: null };
}

/**
 * Whether the package has a page to build: for Vite, `index.html` committed
 * at the root its build reads; for a single-spa application that webpack or
 * Rspack builds as a bundle, an HTML plugin or an HTML file it commits.
 * Anything else, and whatever preparation couldn't read, is checked once the
 * build has run, when the output must contain `index.html`.
 */
function pageCondition(repository: ProfiledRepository, directory: string, tool: { condition: Condition; tool: BuildTool | null }, input: Pick<EligibilityInput, "pages" | "bundles">): Condition {
  if (tool.tool !== "vite") {
    const bundle = input.bundles.get(directory);
    const application = singleSpaApplication(repository, directory);
    if (bundle?.state === "missing" && application && tool.tool) {
      const owned = (input: string) => repository.owner(input) === directory;
      const reason = `Its ${BUILD_TOOL_LABELS[tool.tool]} build emits no page: it's a single-spa application, ${bundle.config} adds no HTML plugin, none is among its dependencies, and no HTML file is committed in ${place(directory)}. Previews need a page that loads the application on its own.`;
      return { condition: "page", passed: false, reason, facts: [repository.decidingFact("composition", application, owned), ...tool.condition.facts] };
    }
    return { condition: "page", passed: true, reason: tool.tool ? `Its build must emit ${PAGE_FILE}, which is checked once it has run` : "Depends on its build tool", facts: [] };
  }
  const facts = tool.condition.facts;
  const read = input.pages.get(directory);
  const fail = (reason: string) => ({ condition: "page" as const, passed: false, reason, facts });
  if (!read) return fail(`Whether it has a page couldn't be decided: its ${PAGE_FILE} wasn't looked for.`);
  if (read.state === "undecided") return fail(`Whether it has a page couldn't be decided: ${read.reason}.`);
  const root = read.config ? `, in the root ${read.config} sets` : "";
  if (read.state === "missing") return fail(`No ${PAGE_FILE} is committed at ${read.page}, the page Vite builds from${root}. Previews need a page that loads the application on its own.`);
  return { condition: "page", passed: true, reason: `Vite builds its page from ${read.page}${root}`, facts };
}

/** Packages that emit a page, as a dependency names them. */
const HTML_PLUGIN_PACKAGES = new Set(["html-webpack-plugin", "html-rspack-plugin", "@rspack/plugin-html"]);
/** The single-spa roles of a bundle a root configuration loads, which has no page of its own unless its build adds one. */
const BUNDLE_ROLES = new Set(["application", "parcel"]);

/** The single-spa application fact the package owns, unless it's also a root configuration, which has a page. */
function singleSpaApplication(repository: ProfiledRepository, directory: string): Fact | null {
  const owned = repository.facts("composition").filter((fact) => fact.state !== "conflicting" && objectValue(fact)?.mechanism === "single-spa" && fact.evidence.some((id) => repository.owner(repository.evidencePath(id)) === directory));
  if (owned.some((fact) => objectValue(fact)?.role === "root-config")) return null;
  return owned.find((fact) => BUNDLE_ROLES.has(String(objectValue(fact)?.role))) ?? null;
}

/**
 * Whether the package's dependencies, or those of the workspace root it
 * installs from, include an HTML plugin; null when the profile couldn't read
 * them, so it can't tell.
 */
function declaresHtmlPlugin(repository: ProfiledRepository, directory: string): boolean | null {
  const manifests = new Set([manifestPath(directory), manifestPath(repository.membership(directory).root ?? directory)]);
  if (repository.unknownReason("dependencies", (input) => manifests.has(input))) return null;
  return repository.facts("dependencies").some((fact) => manifests.has(manifestOfFact(fact)) && HTML_PLUGIN_PACKAGES.has(String(objectValue(fact)?.name ?? "")));
}

/** The commit-level refusal when no package manifest exists, as in a Scala, Go, or Java repository. */
function noPackage(repository: ProfiledRepository): Condition {
  const unknown = repository.unknownReason("frameworks", () => true);
  const languages = repository.facts("languages").map((fact) => repository.decidingFact("languages", fact));
  const reason = unknown
    ? `No browser framework was found, and its frameworks couldn't be decided: ${unknown}. Previews need a client-rendered single-page application with ${list(Object.values(BROWSER_FRAMEWORKS), "or")}.`
    : `No package declares a browser framework. Previews need a client-rendered single-page application with ${list(Object.values(BROWSER_FRAMEWORKS), "or")}.`;
  return { condition: "framework", passed: false, reason, facts: [repository.categoryFact("frameworks"), ...languages] };
}

/** What kind of package it is: a Module Federation remote, a single-spa application, or else a standalone app. Only for display. */
function layoutOf(repository: ProfiledRepository, directory: string): { layout: ArtifactLayout; composition: JsonValue } {
  const owned = repository.facts("composition").filter((fact) => fact.state !== "conflicting" && fact.evidence.some((id) => repository.owner(repository.evidencePath(id)) === directory));
  const remote = owned.find((fact) => objectValue(fact)?.mechanism === "module-federation" && Array.isArray(objectValue(fact)?.exposes) && (objectValue(fact)!.exposes as JsonValue[]).length > 0);
  if (remote) return { layout: "module_federation", composition: remote.value };
  const application = owned.find((fact) => objectValue(fact)?.mechanism === "single-spa" && objectValue(fact)?.role === "application");
  if (application) return { layout: "single_spa", composition: application.value };
  return { layout: "standalone", composition: null };
}

// -- Vite packages ---------------------------------------------------------------

/** The packages that build with Vite, whose page preparation looks for before deciding. */
export function vitePackages(document: FactDocument): string[] {
  const repository = new ProfiledRepository(document);
  return repository.packages.filter((directory) => buildToolCondition(repository, directory).tool === "vite");
}

/**
 * The single-spa applications that webpack or Rspack builds with no HTML
 * plugin among their dependencies, whose configuration and HTML files
 * preparation reads to decide whether their build can emit a page.
 */
export function bundlePackages(document: FactDocument): { directory: string; bundler: Bundler }[] {
  const repository = new ProfiledRepository(document);
  return repository.packages.flatMap((directory) => {
    const { tool } = buildToolCondition(repository, directory);
    if ((tool !== "webpack" && tool !== "rspack") || !singleSpaApplication(repository, directory) || declaresHtmlPlugin(repository, directory) !== false) return [];
    return [{ directory, bundler: tool }];
  });
}

// -- Helpers ----------------------------------------------------------------------

function frameworkId(fact: Fact): string {
  return String(objectValue(fact)?.id ?? fact.key.split("#")[1] ?? "");
}

function frameworkLabel(fact: Fact): string {
  return String(objectValue(fact)?.label ?? frameworkId(fact));
}

function toolId(fact: Fact): string {
  return String(objectValue(fact)?.id ?? fact.key);
}

function toolLabel(fact: Fact): string {
  return String(objectValue(fact)?.label ?? toolId(fact));
}
