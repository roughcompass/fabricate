import fs from "node:fs";
import path from "node:path";
import { type GroupMember, TEMPLATES, type Template } from "@/lib/demo/catalog";
import { STYLES_MODULE, runGates } from "../gates";
import { RUNTIME } from "../render";
import type { GateResult, SampleData } from "../types";
import { type FlattenedPage, flattenMainRoute } from "./flatten";

/**
 * Building the templates (update-templates-salt-quality, design decision 3):
 * every built-in template's committed Salt source, under
 * src/demo/runtime/generated/, checked and indexed without a model. For each
 * template in the catalog it reads the shared data module and every child
 * member version, with its CSS module when it has one; it reads both portal
 * shells; it gates every file with the portal runtime interface allowed and
 * no exemptions; it composes each template's main route into one page; and it
 * writes the index the runtime imports, the sources the Code tab and Use
 * template read, and a manifest of every file's gates.
 *
 * On disk a member imports its template's data from one directory up
 * (`../data`) and its module beside it (`./<version>.module.css`); the gates,
 * the sources, and Use template know them as Prototypes does, `./data` and
 * `./Prototype.module.css`.
 */

export const GENERATED_DIR = "src/demo/runtime/generated";

/** The portal shells, by kind: Access, with a left navigation, and Markets, with a two-row top navigation. */
export const SHELL_KINDS = ["access", "markets"] as const;
export type ShellKind = (typeof SHELL_KINDS)[number];

export interface BuiltVersion {
  readonly member: string;
  readonly version: string;
  readonly prerelease: boolean;
  /** The version's source file, relative to the generated directory. */
  readonly file: string;
  /** Its CSS module's file, or null when it has none. */
  readonly stylesFile: string | null;
  /** The source as Prototypes knows it: importing ./data and ./Prototype.module.css. */
  readonly code: string;
  readonly styles: string | null;
  readonly gates: readonly GateResult[];
}

export interface BuiltPage extends FlattenedPage {
  readonly file: string;
  readonly stylesFile: string | null;
  readonly gates: readonly GateResult[];
}

export interface BuiltTemplate {
  readonly slug: string;
  readonly data: SampleData;
  readonly versions: readonly BuiltVersion[];
  /** The main route as one page, for Use template, variant 0, and the template's Assessment. */
  readonly page: BuiltPage;
}

export interface BuiltShell {
  readonly kind: ShellKind;
  readonly file: string;
  readonly stylesFile: string | null;
  readonly code: string;
  readonly styles: string | null;
  readonly gates: readonly GateResult[];
}

export interface TemplateManifest {
  readonly schema: "fabricate.template_manifest";
  readonly schema_version: 2;
  readonly saltRelease: string;
  readonly templates: readonly {
    readonly slug: string;
    readonly data: string;
    readonly versions: readonly Omit<BuiltVersion, "code" | "styles">[];
    readonly page: Omit<BuiltPage, "code" | "styles">;
  }[];
  readonly shells: readonly Omit<BuiltShell, "code" | "styles">[];
}

/** One problem a build found, by file. */
export interface BuildProblem {
  readonly file: string;
  readonly message: string;
}

export class TemplateBuildError extends Error {
  override name = "TemplateBuildError";
  constructor(readonly problems: readonly BuildProblem[]) {
    super(`${problems.length} problem${problems.length === 1 ? "" : "s"} in the template source:\n${problems.map((problem) => `  ${problem.file}: ${problem.message}`).join("\n")}`);
  }
}

/** Reads a file of the generated directory, or null when it doesn't exist. */
export type Reader = (file: string) => string | null;

export function directoryReader(directory = GENERATED_DIR): Reader {
  return (file) => {
    const full = path.join(directory, file);
    return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
  };
}

/** A version's CSS module on disk, beside its source. */
export const stylesFileOf = (file: string) => file.replace(/\.tsx$/, ".module.css");

/** Source as Prototypes knows it: ./data and ./Prototype.module.css. */
export function canonicalSource(code: string, file: string): string {
  const own = `./${path.basename(stylesFileOf(file))}`;
  return code.replace(/(from\s+["'])\.\.\/data(["'])/g, "$1./data$2").replaceAll(`"${own}"`, `"${STYLES_MODULE}"`).replaceAll(`'${own}'`, `'${STYLES_MODULE}'`);
}

/** Source as written on disk: ../data for a member, and the module beside it. */
export function diskSource(code: string, file: string, dataUp: boolean): string {
  const own = `./${path.basename(stylesFileOf(file))}`;
  const withData = dataUp ? code.replace(/(from\s+["'])\.\/data(["'])/g, "$1../data$2") : code;
  return withData.replaceAll(`"${STYLES_MODULE}"`, `"${own}"`);
}

// Every token the theme the runtime loads defines, read from its CSS.
let saltTokens: ReadonlySet<string> | null = null;
function knownTokens(): ReadonlySet<string> {
  saltTokens ??= new Set(["node_modules/@salt-ds/theme/index.css", "node_modules/@salt-ds/theme/css/theme-next.css"].flatMap((file) => [...fs.readFileSync(path.resolve(file), "utf8").matchAll(/(--salt-[A-Za-z0-9-]+)\s*:/g)].map((match) => match[1]!)));
  return saltTokens;
}

/** Every gate issue in one file, and every --salt- token it names that Salt's theme doesn't define. */
function problemsOf(file: string, gates: readonly GateResult[], ...texts: (string | null)[]): BuildProblem[] {
  const issues = gates.flatMap((result) => result.issues.map((issue) => ({ file, message: `${result.gate} ${issue.code}${issue.line ? ` (line ${issue.line})` : ""}: ${issue.message}` })));
  const tokens = knownTokens();
  const unknown = [...new Set(texts.flatMap((text) => [...(text ?? "").matchAll(/var\(\s*(--salt-[a-z0-9-]+)/gi)].map((match) => match[1]!)))].filter((token) => !tokens.has(token));
  return [...issues, ...unknown.map((token) => ({ file, message: `${token} isn't a token Salt's theme defines.` }))];
}

/** The data module's description, which Use template shows as the sample data's. */
export const dataDescription = (template: Template) => `The records the ${template.title} template shows.`;

/** Builds one template from its files: every member version, gated, and its page, composed and gated. */
export async function buildTemplate(template: Template, read: Reader, problems: BuildProblem[]): Promise<BuiltTemplate | null> {
  const dataFile = `${template.slug}/data.ts`;
  const dataSource = read(dataFile);
  if (dataSource === null) {
    problems.push({ file: dataFile, message: "is missing." });
    return null;
  }
  const data: SampleData = { description: dataDescription(template), source: dataSource };
  const versions: BuiltVersion[] = [];
  for (const member of template.app.members.filter((entry) => entry.role === "child")) {
    for (const entry of member.versions) {
      const file = `${template.slug}/${member.id}/${entry.version}.tsx`;
      const written = read(file);
      if (written === null) {
        problems.push({ file, message: "is missing." });
        continue;
      }
      const stylesFile = stylesFileOf(file);
      const styles = read(stylesFile);
      const code = canonicalSource(written, file);
      const run = await runGates({ code, data: data.source, styles, portal: true });
      problems.push(...problemsOf(file, run.results, code, styles));
      versions.push({ member: member.id, version: entry.version, prerelease: entry.prerelease === true, file, stylesFile: styles === null ? null : stylesFile, code, styles, gates: run.results });
    }
  }
  if (versions.length !== template.app.members.filter((entry) => entry.role === "child").reduce((count, member) => count + member.versions.length, 0)) return null;
  const page = await buildPage(template, data, versions, problems);
  return { slug: template.slug, data, versions, page };
}

/** The version a template's page composes: each member's latest that isn't a prerelease. */
export function conformantVersion(member: GroupMember): string {
  const stable = [...member.versions].reverse().find((version) => !version.prerelease);
  if (!stable) throw new Error(`${member.name} has no version that isn't a prerelease.`);
  return stable.version;
}

/** Flattens a template's main route at its conformant versions and gates the page, with `@deweb/portal` allowed. */
export async function buildPage(template: Template, data: SampleData, versions: readonly BuiltVersion[], problems: BuildProblem[] = []): Promise<BuiltPage> {
  const page = flattenMainRoute(
    template.app,
    template.title,
    (member) => conformantVersion(template.app.members.find((entry) => entry.id === member)!),
    (member, version) => {
      const found = versions.find((entry) => entry.member === member && entry.version === version);
      if (!found) throw new Error(`${template.slug} has no ${member} ${version} to compose its page from.`);
      return { code: found.code, styles: found.styles };
    },
  );
  const file = `${template.slug}/page.tsx`;
  const run = await runGates({ code: page.code, data: data.source, styles: page.styles, portal: true });
  problems.push(...problemsOf(file, run.results));
  return { ...page, file, stylesFile: page.styles ? stylesFileOf(file) : null, gates: run.results };
}

/** Builds one portal shell from its files, gated as a shell. */
export async function buildShell(kind: ShellKind, read: Reader, problems: BuildProblem[]): Promise<BuiltShell | null> {
  const file = `shells/${kind}.tsx`;
  const written = read(file);
  if (written === null) {
    problems.push({ file, message: "is missing." });
    return null;
  }
  const stylesFile = stylesFileOf(file);
  const styles = read(stylesFile);
  const code = canonicalSource(written, file);
  const run = await runGates({ code, data: read("shells/data.ts") ?? "export {};\n", styles, portal: true, shell: true });
  problems.push(...problemsOf(file, run.results, code, styles));
  return { kind, file, stylesFile: styles === null ? null : stylesFile, code, styles, gates: run.results };
}

/**
 * Builds every template and shell, or the ones named; throws a
 * TemplateBuildError listing every problem when any file fails.
 */
export async function buildTemplates(read: Reader = directoryReader(), only?: { readonly slugs?: readonly string[]; readonly shells?: readonly ShellKind[] }): Promise<{ templates: BuiltTemplate[]; shells: BuiltShell[] }> {
  const problems: BuildProblem[] = [];
  const templates: BuiltTemplate[] = [];
  for (const template of TEMPLATES) {
    if (only?.slugs && !only.slugs.includes(template.slug)) continue;
    const built = await buildTemplate(template, read, problems);
    if (built) templates.push(built);
  }
  const shells: BuiltShell[] = [];
  for (const kind of only?.shells ?? (only?.slugs ? [] : SHELL_KINDS)) {
    const built = await buildShell(kind, read, problems);
    if (built) shells.push(built);
  }
  if (problems.length) throw new TemplateBuildError(problems);
  return { templates, shells };
}

const identifier = (...parts: string[]) => parts.join("_").replace(/[^A-Za-z0-9_]/g, "_");

/** The index the runtime's registry imports: every member version and shell, statically, by member and version, and by kind. */
export function generatedIndex(templates: readonly BuiltTemplate[], shells: readonly BuiltShell[]): string {
  const entries = templates.flatMap((template) => template.versions.map((version) => ({ name: identifier(version.member, version.version), path: `./${version.file.replace(/\.tsx$/, "")}`, version })));
  const members = [...new Set(entries.map((entry) => entry.version.member))];
  return [
    'import type { ComponentType, ReactNode } from "react";',
    ...entries.map((entry) => `import ${entry.name} from ${JSON.stringify(entry.path)};`),
    ...shells.map((shell) => `import ${identifier("shell", shell.kind)} from ${JSON.stringify(`./${shell.file.replace(/\.tsx$/, "")}`)};`),
    "",
    "/** Written by `npm run templates:build` (scripts/build-templates.ts): every template's microfrontend versions, by member and version. */",
    "export const GENERATED_MEMBERS: Readonly<Record<string, Readonly<Record<string, ComponentType>>>> = {",
    ...members.map((member) => `  ${JSON.stringify(member)}: { ${entries.filter((entry) => entry.version.member === member).map((entry) => `${JSON.stringify(entry.version.version)}: ${entry.name}`).join(", ")} },`),
    "};",
    "",
    "/** The portal shells, by kind; each takes the current route's content as children. */",
    `export const GENERATED_SHELLS: Readonly<Record<"access" | "markets", ComponentType<{ children: ReactNode }>>> = { ${shells.map((shell) => `${shell.kind}: ${identifier("shell", shell.kind)}`).join(", ")} };`,
    "",
  ].join("\n");
}

export interface TemplateSources {
  readonly data: string;
  readonly page: string;
  /** The page's CSS module, merged from its members', or null. */
  readonly pageStyles: string | null;
  /** Each member version's source, importing ./data and ./Prototype.module.css. */
  readonly members: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Each member version's CSS module, where it has one. */
  readonly memberStyles: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Every template's data, page, and member sources and modules, as text: for the Code tab, Use template, variant 0, and the template's Assessment. */
export function generatedSources(templates: readonly BuiltTemplate[]): string {
  const sources: Record<string, TemplateSources> = Object.fromEntries(
    templates.map((template) => {
      const members = [...new Set(template.versions.map((version) => version.member))];
      const byMember = (pick: (version: BuiltVersion) => string | null) => Object.fromEntries(members.map((member) => [member, Object.fromEntries(template.versions.filter((version) => version.member === member && pick(version) !== null).map((version) => [version.version, pick(version)!]))]).filter(([, versions]) => Object.keys(versions as object).length > 0));
      return [template.slug, { data: template.data.source, page: template.page.code, pageStyles: template.page.styles, members: byMember((version) => version.code), memberStyles: byMember((version) => version.styles) }];
    }),
  );
  return [
    'import type { TemplateSources } from "@/lib/prototypes/heroes/build";',
    "",
    "/** Written by `npm run templates:build` (scripts/build-templates.ts): every template's data, page, and member sources, for its Code tab and Use template. */",
    `export const GENERATED_SOURCES: Readonly<Record<string, TemplateSources>> = ${JSON.stringify(sources, null, 2)};`,
    "",
  ].join("\n");
}

const withoutText = <T extends { code: string; styles: string | null }>({ code: _code, styles: _styles, ...rest }: T) => rest;

export function templateManifest(templates: readonly BuiltTemplate[], shells: readonly BuiltShell[]): TemplateManifest {
  return {
    schema: "fabricate.template_manifest",
    schema_version: 2,
    saltRelease: RUNTIME.packages["@salt-ds/core"] ?? "",
    templates: templates.map((template) => ({ slug: template.slug, data: `${template.slug}/data.ts`, versions: template.versions.map(withoutText), page: withoutText(template.page) })),
    shells: shells.map(withoutText),
  };
}

/** The files a build writes, by path relative to the generated directory: each page and its module, the index, the sources, and the manifest. */
export function builtFiles(templates: readonly BuiltTemplate[], shells: readonly BuiltShell[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const template of templates) {
    files[template.page.file] = diskSource(template.page.code, template.page.file, false);
    if (template.page.stylesFile && template.page.styles) files[template.page.stylesFile] = template.page.styles;
  }
  files["index.ts"] = generatedIndex(templates, shells);
  files["sources.ts"] = generatedSources(templates);
  files["manifest.json"] = `${JSON.stringify(templateManifest(templates, shells), null, 2)}\n`;
  return files;
}
