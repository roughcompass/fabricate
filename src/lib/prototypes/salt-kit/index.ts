import type { SaltRegistry } from "../salt/adapter";
import type { LessonCopy } from "../types";
import { RULES } from "./rules";

/**
 * The Salt kit (design.md, decision 6): the generator's instructions, a
 * versioned set of rules plus a catalog generated from the committed Salt
 * registry, so the components it names are those of the release DE FabLab
 * renders with. Each version records the kit version it was written with.
 */

/** Bumped whenever a rule changes. */
export const KIT_VERSION = "2026-10-16.3";

/** Packages generated code may import, as the registry names them. */
const CATALOG_PACKAGES = ["@salt-ds/core", "@salt-ds/date-components", "@salt-ds/countries", "@salt-ds/icons", "@salt-ds/lab"] as const;

/** Components that are the frame's job, never the generated code's. */
const PROVIDED = new Set(["Salt provider", "Localization provider", "Semantic icon provider"]);

/** Where a registry name isn't the exported component's name. */
const EXPORTS: Record<string, string> = {
  "Date input": "DateInputSingle, DateInputRange",
  Progress: "LinearProgress, CircularProgress",
  "Range date picker": 'DatePicker with selectionVariant="range"',
};

export interface CatalogEntry {
  readonly name: string;
  readonly exports: string;
  readonly package: string;
  readonly status: string;
}

const pascal = (name: string) =>
  name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join("");

/** The components generated code may use, from the registry. */
export function catalog(registry: SaltRegistry): CatalogEntry[] {
  return registry.components
    .filter((component) => (CATALOG_PACKAGES as readonly string[]).includes(component.package.name) && !PROVIDED.has(component.name))
    .map((component) => ({ name: component.name, exports: EXPORTS[component.name] ?? pascal(component.name), package: component.package.name, status: component.status }))
    .sort((a, b) => a.package.localeCompare(b.package) || a.name.localeCompare(b.name));
}

function catalogText(registry: SaltRegistry): string {
  const entries = catalog(registry);
  const sections = CATALOG_PACKAGES.map((name) => {
    const inPackage = entries.filter((entry) => entry.package === name);
    if (inPackage.length === 0) return null;
    const label = name === "@salt-ds/lab" ? `${name} (pre-release: warns)` : name;
    return `- ${label}: ${inPackage.map((entry) => (entry.exports === entry.name.replace(/[^A-Za-z0-9]/g, "") ? entry.exports : `${entry.name} (${entry.exports})`)).join(", ")}`;
  }).filter(Boolean);
  const patterns = registry.patterns.map((pattern) => pattern.name).join(", ");
  const release = registry.packages.find((entry) => entry.name === "@salt-ds/core")?.version;
  return `# Salt catalog (Salt ${release})\nComponents, by package:\n${sections.join("\n")}\nPatterns, which get_pattern and get_composition_recipe describe: ${patterns}.\nTabs are in @salt-ds/core, and dates are in @salt-ds/date-components, not lab.`;
}

const holder = new WeakMap<SaltRegistry, string>();

/** The kit's text for a registry, built once per registry. */
export function kitText(registry: SaltRegistry): string {
  let text = holder.get(registry);
  if (!text) {
    text = [...RULES, catalogText(registry)].join("\n\n");
    holder.set(registry, text);
  }
  return text;
}

/** The active lessons, appended as numbered rules with their scope (design.md, decision 6). */
export function lessonRules(lessons: readonly LessonCopy[]): string {
  if (lessons.length === 0) return "";
  const rules = lessons.map((lesson, index) => `${index + 1}. ${lesson.text} (${lesson.category}; ${lesson.scope.kind === "general" ? "every persona" : `for ${lesson.scope.personaName}`})`);
  return `# Lessons from this workspace\nEarlier feedback taught these. Follow them unless the request says otherwise.\n${rules.join("\n")}`;
}

/** The generator's instructions: the kit, then the lessons it applies. */
/**
 * The addendum for hero generation (converge-templates-and-prototypes,
 * design decision 6): what a hero portal's microfrontends and shells may use
 * besides React and Salt, where their regions sit, and the sample data they
 * share.
 */
export const PORTAL_ADDENDUM = `# Hero portals
You are writing one part of a hero portal: a microfrontend that fills one region of a route, or the portal's shell. Write real Salt, as a product team would ship it.

## @deweb/portal
Besides React and Salt, import only this, and only what you use:
- useBus(topic, member, handler): subscribe this member to a bus topic while it's mounted. Topics name an event, such as "payee:selected".
- usePublish(member): returns publish(topic, payload). Publish when the user does something another region reacts to.
- useProfile(): the signed-in user as { name, persona, region }. Show content that depends on the role by persona, such as Approver.
- useRoute(): { current, routes }, each { path, label, href }. Link between routes with routeHref(route) as the href, and open them with useNavigate()(route) on click so the page doesn't reload; never build addresses yourself.
- useApplication(): { name, portal, environment }: the application's name, the portal's name for its wordmark, and Production, Sandbox, Dev, or null.
- planted.blockMainThread(ms): only where the instructions name the planted slow interaction.
Use the member id you are given as \`member\`, exactly.

## Regions
A route lays its microfrontends out in areas: main, the primary work area; side, a narrow column beside it; and wide, a full-width band. Size the component for its area: a side region is narrow and summarizes, and a main region carries the task. Don't add page chrome: the shell provides the header, navigation, and footer.

## Shared sample data
Every microfrontend and the shell of a hero import the same ./data module. Import only the exports you need, never redefine them, and never change their shape. Show the same records the other regions show, so selecting a payee in one region finds the same payee in another.

## Shells
A shell takes its routes from useRoute() and renders the current route's content as children. It takes its colors, type, and spacing from Salt's theme only, in light and dark.`;

export function instructions(registry: SaltRegistry, lessons: readonly LessonCopy[], options: { portal?: boolean } = {}): string {
  return [kitText(registry), options.portal ? PORTAL_ADDENDUM : "", lessonRules(lessons)].filter(Boolean).join("\n\n");
}
