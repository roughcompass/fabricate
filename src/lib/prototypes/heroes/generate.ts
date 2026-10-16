import { eq } from "drizzle-orm";
import { type GroupMember, type MemberVersion, type PlantedRule, templateBySlug } from "@/lib/demo/catalog";
import { type PrototypesSettings, getConfig } from "@/lib/config";
import { orchestrateGeneration, orchestrateRefinement } from "@/workflows/prototypes/orchestrate";
import type { PrototypesExecutor } from "../db/client";
import { variants, versions } from "../db/schema";
import { startRefinement } from "../pipeline/refine";
import { startHeroGeneration } from "../pipeline/start";
import { KIT_VERSION } from "../salt-kit";
import { RUNTIME } from "../render";
import { AXES, type GateResult, type SampleData } from "../types";
import { keepVariant } from "../variants";
import { type FlattenedPage, flattenMainRoute } from "./flatten";
import { PLANTED, plantedExemptions } from "./planted";
import { runGates } from "../gates";
import { MEMBER_FILES, SHELL_FILES, heroData, runtimeSource, versionExpression } from "./sources";

/**
 * Hero generation (converge-templates-and-prototypes, design decision 6): the
 * Prototypes pipeline's own steps write every microfrontend version of a
 * hero template and the portal shells, so the running heroes are real Salt
 * that passes DE FabLab's gates. Each version ports its hand-written source to
 * Salt, keeping what it shows and does, so the runtime and its toolbar work
 * unchanged. Each member's stable version is generated first, against one
 * shared data module per hero lifted from the hand-written records; its other
 * versions are refinements of it with scripted messages, from the catalog's
 * version summaries, and a planted version is asked for exactly the
 * catalog's planted rules, which are its only gate exemptions.
 * `scripts/generate-heroes.ts` runs this once with a model key, and its
 * output is committed.
 */

export interface GeneratedVersion {
  readonly member: string;
  readonly version: string;
  readonly prerelease: boolean;
  readonly planted: readonly PlantedRule[];
  /** Where the version's source is written, relative to the output directory. */
  readonly file: string;
  readonly code: string;
  readonly gates: readonly GateResult[];
  /** Each planted rule, the gate issue codes it may waive, and the issues it did waive. */
  readonly exemptions: readonly { readonly rule: string; readonly codes: readonly string[]; readonly exempted: readonly string[] }[];
  readonly provenance: { readonly model: string; readonly generationId: string; readonly refinedFrom: string | null; readonly message: string | null; readonly edits?: readonly string[] };
}

export interface GeneratedPage extends FlattenedPage {
  readonly file: string;
  readonly gates: readonly GateResult[];
}

export interface GeneratedHero {
  readonly slug: string;
  readonly data: SampleData;
  readonly versions: readonly GeneratedVersion[];
  /** The hero's main route as one page, for Use template, variant 0, and its template Assessment. */
  readonly page: GeneratedPage;
}

export class HeroGenerationError extends Error {
  override name = "HeroGenerationError";
}

/** The version a member's other versions are refined from: its latest that is neither a prerelease nor planted. */
export function stableVersion(member: GroupMember): MemberVersion {
  const stable = [...member.versions].reverse().find((version) => !version.prerelease && !version.planted?.length);
  if (!stable) throw new HeroGenerationError(`${member.name} has no version that is neither a prerelease nor planted.`);
  return stable;
}

/** What the member does on the bus, for its role, and when it's the slow one: the same for every one of its versions. */
function memberIntent(hero: string, member: GroupMember, area: string): string {
  return [
    `${member.name}, the ${member.id} microfrontend of the ${hero} hero portal, in the route's ${area} area.`,
    ...(member.publishes ?? []).map((topic) => `When the user selects a record, publish "${topic}" with its id and name.`),
    ...(member.subscribes ?? []).map((topic) => `Subscribe to "${topic}" and show the record it names.`),
    member.roleDependent ? "Show content that changes for the Approver persona, such as an approval column only they see." : "",
    member.slowInteraction ? `Its "${member.slowInteraction.label}" action calls planted.blockMainThread(${member.slowInteraction.blockMs}) before it updates: this is the planted slow interaction, and the only one.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The scripted message that turns a member's stable version into another of its versions. */
export function versionMessage(member: GroupMember, version: MemberVersion): string {
  return [
    `Make ${member.name} ${version.version}: ${version.summary}.`,
    version.prerelease ? "It's a prerelease: keep the stable version's behavior and change only what this summary says." : "",
    ...(version.planted ?? []).map((rule) => `Planted defect (${rule}), on purpose and nowhere else: ${PLANTED[rule].instruction}`),
  ]
    .filter(Boolean)
    .join(" ");
}

/** What a version ports: its hand-written expression in the file's members map, and the whole file, for its helpers and records. */
export function portReference(slug: string, member: GroupMember, version: MemberVersion): string {
  const file = MEMBER_FILES[slug]!;
  const source = runtimeSource(file);
  const expression = versionExpression(source, member.id, version.version);
  if (!expression) throw new HeroGenerationError(`${file} has no ${member.id} ${version.version} in its members map.`);
  return `Hand-written ${member.name} ${version.version}, which ${file}'s members map gives as \`${expression}\`. Port that version only. The whole file, for its helpers and records:\n\`\`\`tsx\n${source}\n\`\`\``;
}

async function readyVersion(db: PrototypesExecutor, generationId: string, what: string) {
  const [row] = await db.select({ variant: variants, version: versions }).from(variants).innerJoin(versions, eq(versions.id, variants.versionId)).where(eq(variants.generationId, generationId));
  if (!row || row.version.status !== "ready") {
    const [variant] = await db.select().from(variants).where(eq(variants.generationId, generationId));
    const issues = (variant?.failure?.issues ?? []).slice(0, 12).map((issue) => `\n  - ${issue.code}${issue.line ? ` (line ${issue.line})` : ""}: ${issue.message}`);
    throw new HeroGenerationError(`${what} didn't pass the gates: ${variant?.failure?.message ?? "the variant failed"}${issues.join("")}`);
  }
  return row;
}

/** Tries a generation again once when it doesn't pass its gates: a model's ports vary, and one bad attempt shouldn't stop a run. */
async function twice<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof HeroGenerationError)) throw error;
    return attempt();
  }
}

function generated(member: string, version: MemberVersion, code: string, gates: readonly GateResult[], provenance: GeneratedVersion["provenance"]): GeneratedVersion {
  const planted = version.planted ?? [];
  const exempted = gates.flatMap((result) => result.exempted ?? []);
  return {
    member,
    version: version.version,
    prerelease: version.prerelease === true,
    planted,
    file: `${member}/${version.version}.tsx`,
    code,
    gates,
    exemptions: plantedExemptions(planted).map((exemption) => ({ ...exemption, exempted: exempted.filter((entry) => entry.rule === exemption.rule).map((entry) => entry.issue.code) })),
    provenance,
  };
}

/** Generates every microfrontend version of one hero template, in catalog order, against one shared data module. */
export async function generateHero(db: PrototypesExecutor, workspaceId: string, slug: string, settings: PrototypesSettings = getConfig().prototypes): Promise<GeneratedHero> {
  const template = templateBySlug(slug);
  if (!template || template.app.kind !== "hero") throw new HeroGenerationError(`${slug} is not a hero template.`);
  const { app } = template;
  const areaOf = (member: string) => app.routes.flatMap((route) => route.regions).find((region) => region.member === member)?.area ?? "main";
  // Every region of a hero shows the hand-written records, lifted without a model.
  const data = heroData(runtimeSource(MEMBER_FILES[slug]!), slug);
  const out: GeneratedVersion[] = [];
  for (const member of app.members.filter((entry) => entry.role === "child")) {
    const stable = stableVersion(member);
    const intent = memberIntent(template.title, member, areaOf(member.id));
    const direction = { title: `${member.name} ${stable.version}`, sentence: `${stable.summary}.`, axis: AXES[0], recipe: null };
    const { generationId, kept } = await twice(async () => {
      const generationId = await startHeroGeneration(
        db,
        workspaceId,
        { intent, scope: "portal-member", personaIds: [], hero: { slug, member: member.id, reference: portReference(slug, member, stable) }, plan: { direction, sampleData: data } },
        settings,
      );
      await orchestrateGeneration(generationId);
      return { generationId, kept: await readyVersion(db, generationId, `${member.name} ${stable.version}`) };
    });
    const { prototypeId } = await keepVariant(db, workspaceId, kept.variant.id, "");
    out.push(generated(member.id, stable, kept.version.code, kept.version.attempts.at(-1)?.gates ?? [], { model: kept.version.provenance?.model ?? settings.models.generate, generationId, refinedFrom: null, message: null }));

    for (const version of member.versions.filter((entry) => entry !== stable)) {
      const message = versionMessage(member, version);
      const { refinementId, refined } = await twice(async () => {
        const refinementId = await startRefinement(db, workspaceId, prototypeId, kept.version.id, message, settings, new Date(), { slug, member: member.id, planted: version.planted ?? [], reference: portReference(slug, member, version) });
        await orchestrateRefinement(refinementId);
        return { refinementId, refined: await readyVersion(db, refinementId, `${member.name} ${version.version}`) };
      });
      out.push(generated(member.id, version, refined.version.code, refined.version.attempts.at(-1)?.gates ?? [], { model: refined.version.provenance?.model ?? settings.models.generate, generationId: refinementId, refinedFrom: stable.version, message }));
    }
  }
  return { slug, data, versions: out, page: await heroPage(slug, data, out) };
}

/** Flattens a hero's main route at its conformant versions and checks the page with the four gates, with `@deweb/portal` allowed. */
export async function heroPage(slug: string, data: SampleData, versions: readonly GeneratedVersion[]): Promise<GeneratedPage> {
  const template = templateBySlug(slug)!;
  const members = template.app.members;
  const page = flattenMainRoute(
    template.app,
    template.title,
    (member) => stableVersion(members.find((entry) => entry.id === member)!).version,
    (member, version) => {
      const found = versions.find((entry) => entry.member === member && entry.version === version);
      if (!found) throw new HeroGenerationError(`${slug} has no generated ${member} ${version} to compose its page from.`);
      return found.code;
    },
  );
  const run = await runGates({ code: page.code, data: data.source, portal: true });
  if (!run.passed) throw new HeroGenerationError(`${template.title}'s page didn't pass the gates: ${run.results.flatMap((result) => result.issues.map((issue) => `${result.gate} ${issue.code}: ${issue.message}`)).slice(0, 6).join("; ")}`);
  return { ...page, file: "page.tsx", gates: run.results };
}

/** A portal shell, as hero generation writes it: Access, with a left navigation, or Markets, with a two-row top navigation. */
export type ShellKind = "access" | "markets";

export interface GeneratedShell {
  readonly kind: ShellKind;
  readonly file: string;
  readonly code: string;
  readonly gates: readonly GateResult[];
  readonly provenance: { readonly model: string; readonly generationId: string; readonly edits?: readonly string[] };
}

/** What each shell is (portal-runtime spec, "The Access shell has a left navigation and header actions" and "The Markets shell has a two-row top navigation and a title band"). */
export const SHELL_INTENTS: Readonly<Record<ShellKind, string>> = {
  access:
    "The J.P. Morgan Access portal shell. A header with a menu control that hides and shows the left navigation, the 'J.P.Morgan | Access' wordmark, and at its right end header actions for search, notifications, and help, then the user menu with useProfile()'s name. A left navigation lists Home, a group named for the application that expands to show useRoute()'s routes with the current one marked as Salt's navigation marks it, and Reports and Insights and Support Hub groups, each with an icon. The content area shows breadcrumbs ending with the current route above its title, then children. On narrow screens the navigation is hidden until the menu control opens it.",
  markets:
    "The J.P. Morgan Markets portal shell. A top bar with the 'J.P. Morgan Markets' wordmark, an application switcher control, primary tabs that mark the current one, and the user menu with useProfile()'s name at its right end. A second row lists useRoute()'s routes as tabs with the current one marked. Each page opens with a band carrying the current route's label in Salt's display typography, on a surface that contrasts with the content area, then children. A footer shows the J.P.Morgan wordmark with Terms of Use, Disclosures, Security, Privacy, Cookies Policy, and Contact Us links.",
};

/** A shell needs no records of its own. */
const SHELL_DATA: SampleData = { description: "No records: a shell shows the application's routes and the signed-in user.", source: "export {};\n" };

/** What a shell ports: its hand-written source and the shared parts it uses. Its default export takes `{ children }`, the current route's content. */
function shellReference(kind: ShellKind): string {
  const files = SHELL_FILES[kind].map((file) => `// ${file}\n${runtimeSource(file)}`).join("\n\n");
  return `Hand-written ${kind === "access" ? "Access" : "Markets"} shell, with the shared parts it uses. Port the shell as one module whose default export is \`export default function Shell({ children }: { children: ReactNode })\` and renders children as the current route's content. The runtime wraps it in the portal's root element, so leave PortalRoot out. Keep the colors only from Salt's theme, which the brand palettes and CSS modules here don't:\n\`\`\`tsx\n${files}\n\`\`\``;
}

/** Generates one portal shell by porting its hand-written source. */
export async function generateShell(db: PrototypesExecutor, workspaceId: string, kind: ShellKind, settings: PrototypesSettings = getConfig().prototypes): Promise<GeneratedShell> {
  const direction = { title: `${kind === "access" ? "Access" : "Markets"} shell`, sentence: "The portal shell, in Salt's theme only, in light and dark.", axis: AXES[2], recipe: null };
  const { generationId, version } = await twice(async () => {
    const generationId = await startHeroGeneration(db, workspaceId, { intent: SHELL_INTENTS[kind], scope: "portal-shell", personaIds: [], hero: { slug: `${kind}-shell`, member: null, reference: shellReference(kind) }, plan: { direction, sampleData: SHELL_DATA } }, settings);
    await orchestrateGeneration(generationId);
    return { generationId, version: (await readyVersion(db, generationId, direction.title)).version };
  });
  return { kind, file: `shells/${kind}.tsx`, code: version.code, gates: version.attempts.at(-1)?.gates ?? [], provenance: { model: version.provenance?.model ?? settings.models.generate, generationId } };
}

export interface HeroManifest {
  readonly schema: "fabricate.hero_manifest";
  readonly schema_version: 1;
  readonly kitVersion: string;
  readonly saltRelease: string;
  readonly heroes: readonly {
    readonly slug: string;
    readonly data: { readonly file: string; readonly description: string };
    readonly versions: readonly Omit<GeneratedVersion, "code">[];
    readonly page: Omit<GeneratedPage, "code">;
  }[];
  readonly shells: readonly Omit<GeneratedShell, "code">[];
}

/** The manifest for generated heroes: each version's file, gates, exemptions, and provenance. Files are relative to the output directory. */
export function heroManifest(heroes: readonly GeneratedHero[], shells: readonly GeneratedShell[] = []): HeroManifest {
  return {
    schema: "fabricate.hero_manifest",
    schema_version: 1,
    kitVersion: KIT_VERSION,
    saltRelease: RUNTIME.packages["@salt-ds/core"] ?? "",
    heroes: heroes.map((hero) => ({
      slug: hero.slug,
      data: { file: `${hero.slug}/data.ts`, description: hero.data.description },
      versions: hero.versions.map(({ code: _code, ...version }) => ({ ...version, file: `${hero.slug}/${version.file}` })),
      page: (({ code: _code, ...page }) => ({ ...page, file: `${hero.slug}/${page.file}` }))(hero.page),
    })),
    shells: shells.map(({ code: _code, ...shell }) => shell),
  };
}

/** A member's source as written: its `./data` import points at the hero's shared data.ts, one directory up. */
export function memberSource(code: string): string {
  return code.replace(/(from\s+["'])\.\/data(["'])/g, "$1../data$2");
}

const identifier = (...parts: string[]) => parts.join("_").replace(/[^A-Za-z0-9_]/g, "_");

/** The index the runtime's registry imports: every generated version and shell, statically, by member and version, and by kind. */
export function generatedIndex(heroes: readonly GeneratedHero[], shells: readonly GeneratedShell[] = []): string {
  const entries = heroes.flatMap((hero) => hero.versions.map((version) => ({ name: identifier(version.member, version.version), path: `./${hero.slug}/${version.file.replace(/\.tsx$/, "")}`, version })));
  const members = [...new Set(entries.map((entry) => entry.version.member))];
  return [
    'import type { ComponentType, ReactNode } from "react";',
    ...entries.map((entry) => `import ${entry.name} from ${JSON.stringify(entry.path)};`),
    ...shells.map((shell) => `import ${identifier("shell", shell.kind)} from ${JSON.stringify(`./${shell.file.replace(/\.tsx$/, "")}`)};`),
    "",
    "/** Written by `npm run heroes:generate` (scripts/generate-heroes.ts): every generated microfrontend version, by member and version. */",
    "export const GENERATED_MEMBERS: Readonly<Record<string, Readonly<Record<string, ComponentType>>>> = {",
    ...members.map((member) => `  ${JSON.stringify(member)}: { ${entries.filter((entry) => entry.version.member === member).map((entry) => `${JSON.stringify(entry.version.version)}: ${entry.name}`).join(", ")} },`),
    "};",
    "",
    "/** The generated portal shells, by kind; each takes the current route's content as children. */",
    `export const GENERATED_SHELLS: Readonly<Partial<Record<"access" | "markets", ComponentType<{ children: ReactNode }>>>> = { ${shells.map((shell) => `${shell.kind}: ${identifier("shell", shell.kind)}`).join(", ")} };`,
    "",
  ].join("\n");
}

/**
 * The source of every generated version, each hero's data, and its flattened
 * page, as text: for a hero template's Code tab (template-preview spec, "The
 * Code tab shows the template's files"), where members import `./data` as a
 * visitor's project would, and for Use template, variant 0, and the hero's
 * template Assessment.
 */
export function generatedSources(heroes: readonly GeneratedHero[]): string {
  const sources = Object.fromEntries(heroes.map((hero) => [hero.slug, { data: hero.data.source, page: hero.page.code, members: Object.fromEntries([...new Set(hero.versions.map((version) => version.member))].map((member) => [member, Object.fromEntries(hero.versions.filter((version) => version.member === member).map((version) => [version.version, version.code]))])) }]));
  return [
    "/** Written by `npm run heroes:generate` (scripts/generate-heroes.ts): each hero's data and every generated version's source, for its Code tab. */",
    `export const GENERATED_SOURCES: Readonly<Record<string, { readonly data: string; readonly page: string; readonly members: Readonly<Record<string, Readonly<Record<string, string>>>> }>> = ${JSON.stringify(sources, null, 2)};`,
    "",
  ].join("\n");
}

/** Every file a run writes, by path relative to the output directory, with the index and the manifest last. */
export function heroFiles(heroes: readonly GeneratedHero[], shells: readonly GeneratedShell[] = []): Record<string, string> {
  const files: Record<string, string> = {};
  if (shells.length) files["shells/data.ts"] = SHELL_DATA.source;
  for (const shell of shells) files[shell.file] = shell.code;
  for (const hero of heroes) {
    files[`${hero.slug}/data.ts`] = hero.data.source;
    for (const version of hero.versions) files[`${hero.slug}/${version.file}`] = memberSource(version.code);
    files[`${hero.slug}/${hero.page.file}`] = hero.page.code;
  }
  files["index.ts"] = generatedIndex(heroes, shells);
  files["sources.ts"] = generatedSources(heroes);
  files["manifest.json"] = `${JSON.stringify(heroManifest(heroes, shells), null, 2)}\n`;
  return files;
}

/**
 * The heroes and shells a committed run wrote, read back from its manifest and
 * files, with each hero's page composed again, so the index, sources, and
 * pages can be written again without a model.
 */
export async function readGenerated(read: (file: string) => string): Promise<{ heroes: GeneratedHero[]; shells: GeneratedShell[] }> {
  const manifest = JSON.parse(read("manifest.json")) as HeroManifest;
  const heroes = await Promise.all(
    manifest.heroes.map(async (hero): Promise<GeneratedHero> => {
      const data = { description: hero.data.description, source: read(hero.data.file) };
      // Files on disk import ../data; a version's code, as generated, imports ./data.
      const versions = hero.versions.map((version) => ({ ...version, file: version.file.slice(hero.slug.length + 1), code: read(version.file).replace(/(from\s+["'])\.\.\/data(["'])/g, "$1./data$2") }));
      return { slug: hero.slug, data, versions, page: await heroPage(hero.slug, data, versions) };
    }),
  );
  const shells = manifest.shells.map((shell): GeneratedShell => ({ ...shell, code: read(shell.file) }));
  return { heroes, shells };
}
