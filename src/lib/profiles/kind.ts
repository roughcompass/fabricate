import { countLabel } from "@/components/ui/count";
import { isJsonObject } from "@/lib/json";
import { type Fact, type FactDocument, categoryOf } from "./states";

/**
 * Whether a Profile describes a frontend web repository, which is what
 * Fabricate profiles, and the facts that decided it. A repository is one when
 * it uses a UI framework, composes or is composed through a mechanism such as
 * Module Federation, renders UI elements, recognizes a design system, builds
 * with a browser bundler, or is mostly markup and stylesheets. A service,
 * infrastructure, or other repository has none of these, so the views that
 * only apply to a frontend (composition and design system) don't
 * apply to it.
 */
export interface RepositoryKind {
  frontend: boolean;
  /** What made it a frontend, in words, such as "React" or "Module Federation". Empty when it isn't one. */
  signals: string[];
  /** Its main languages by file count, such as "Java (3,295 files)", for saying what it is instead. */
  languages: string[];
}

// Frameworks that render a UI in the browser, by the id the frameworks category reports. Server frameworks such as Express, Fastify, and Hono aren't.
const UI_FRAMEWORKS = new Set(["react", "preact", "vue", "angular", "svelte", "sveltekit", "solid", "lit", "next", "nuxt", "remix", "astro", "ember", "qwik", "gatsby", "stencil"]);
// Build tools that bundle for the browser. A TypeScript compiler, Babel, or a monorepo tool builds any JavaScript, so they don't decide it.
const BROWSER_BUNDLERS = new Set(["vite", "webpack", "rspack", "rsbuild", "parcel", "turbopack"]);
// Languages a browser renders directly; a repository mostly of these is a site even without a framework.
const MARKUP = new Set(["HTML", "CSS", "Sass", "SCSS", "Less", "Stylus", "Vue", "Svelte", "Astro"]);
// Data, documentation, and configuration formats, which don't say what a repository is.
const NEUTRAL = new Set(["JSON", "JSON5", "YAML", "TOML", "Markdown", "MDX", "XML", "INI", "Text", "SVG"]);

const facts = (document: FactDocument, id: string): Fact[] => categoryOf(document, id)?.facts ?? [];
const field = (fact: Fact, name: string): string | null => (isJsonObject(fact.value) && typeof fact.value[name] === "string" ? (fact.value[name] as string) : null);
const files = (fact: Fact): number => (isJsonObject(fact.value) && typeof fact.value.files === "number" ? fact.value.files : 0);

export function repositoryKind(document: FactDocument): RepositoryKind {
  const signals = new Set<string>();
  for (const fact of facts(document, "frameworks")) if (UI_FRAMEWORKS.has(field(fact, "id") ?? "")) signals.add(field(fact, "label") ?? field(fact, "id")!);
  if (facts(document, "composition").length) signals.add("a composition mechanism");
  if (facts(document, "design_systems").length) signals.add("a design system");
  if (facts(document, "ui_elements").length) signals.add("UI elements");
  for (const fact of facts(document, "build_tools")) if (BROWSER_BUNDLERS.has(field(fact, "id") ?? "")) signals.add(field(fact, "label") ?? field(fact, "id")!);

  const languages = [...facts(document, "languages")].sort((a, b) => files(b) - files(a));
  const code = languages.filter((fact) => !NEUTRAL.has(fact.key));
  const markup = code.filter((fact) => MARKUP.has(fact.key)).reduce((sum, fact) => sum + files(fact), 0);
  const total = code.reduce((sum, fact) => sum + files(fact), 0);
  if (total > 0 && markup * 2 >= total) signals.add("mostly markup and stylesheets");

  return {
    frontend: signals.size > 0,
    signals: [...signals],
    languages: code.slice(0, 3).map((fact) => `${fact.key} (${countLabel(files(fact), "file")})`),
  };
}
