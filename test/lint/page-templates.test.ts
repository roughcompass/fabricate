import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The template check (operator-interface/page-templates spec, "Every page uses
 * one page template"): every operator page renders exactly one of the ten
 * templates, directly or through the components it renders, and every
 * not-found and error page renders the System template.
 */

const SRC = path.resolve("src");
const OPERATOR = path.join(SRC, "app/(operator)");
/** The product site's pages: the marketing page and the docs. */
const SITE = path.join(SRC, "app/(site)");
const TEMPLATE_COMPONENTS = ["DashboardTemplate", "IndexTemplate", "DetailsTemplate", "AnalysisTemplate", "FormTemplate", "FlowTemplate", "EditorTemplate", "SettingsTemplate", "ContentTemplate", "SystemTemplate"];

type Read = (file: string) => string | undefined;

const readFile: Read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined);

/** The file an import specifier names, from +from+: relative paths and the `@/` alias, with or without an extension. */
function resolve(specifier: string, from: string, read: Read): string | undefined {
  const base = specifier.startsWith("@/") ? path.join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : undefined;
  if (!base) return undefined;
  return [base, `${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx")].find((candidate) => candidate.endsWith(".tsx") && read(candidate) !== undefined);
}

/**
 * The templates a module renders: those it names in JSX, and those of every
 * component it imports and renders, other than the shared library's own
 * (which never render a template), the templates' own modules, and the
 * component gallery's specimens, which show every template as an example.
 */
function templatesOf(file: string, read: Read = readFile, seen = new Set<string>()): Set<string> {
  const found = new Set<string>();
  if (seen.has(file)) return found;
  seen.add(file);
  const source = read(file) ?? "";
  const rendered = new Set([...source.matchAll(/<([A-Z]\w*)\b/g)].map((match) => match[1]!));
  for (const name of rendered) if (TEMPLATE_COMPONENTS.includes(name)) found.add(name);
  for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"|import\s+(\w+)\s+from\s+"([^"]+)"/g)) {
    const names = match[1] ? match[1].split(",").map((name) => name.trim().split(/\s+as\s+/).at(-1)!) : [match[3]!];
    const specifier = match[2] ?? match[4]!;
    if (!names.some((name) => rendered.has(name)) || /^@\/components\/(ui|templates)\/|^\.\/specimens\//.test(specifier)) continue;
    const target = resolve(specifier, file, read);
    if (target) for (const name of templatesOf(target, read, seen)) found.add(name);
  }
  return found;
}

/** A page that renders nothing, because it only redirects or throws, returns no JSX. */
const renders = (source: string) => /return\s*\(?\s*</.test(source);

/** Every file named +name+ under +directory+, leaving out parallel-route slots, which mirror pages that exist on their own. */
function filesNamed(directory: string, name: RegExp): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith("@") ? [] : filesNamed(full, name);
    return name.test(entry.name) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(process.cwd(), file);

describe("page templates", () => {
  const pages = [...filesNamed(OPERATOR, /^page\.tsx$/), ...filesNamed(SITE, /^page\.tsx$/)];

  it("finds the operator pages", () => {
    expect(pages.length).toBeGreaterThan(30);
  });

  it("builds every operator page from exactly one template (Every route has a template)", () => {
    const problems = pages.flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      if (!renders(source)) return [];
      const used = [...templatesOf(file)];
      return used.length === 1 ? [] : [`${relative(file)} uses ${used.length ? used.join(" and ") : "no template"}`];
    });
    expect(problems).toEqual([]);
  });

  it("builds every not-found and error page from the System template", () => {
    const files = [...filesNamed(path.join(SRC, "app"), /^(not-found|error|global-error)\.tsx$/)].filter((file) => !file.includes(`${path.sep}(runtime)${path.sep}`));
    expect(files.length).toBeGreaterThan(5);
    const problems = files.flatMap((file) => {
      const used = [...templatesOf(file)];
      return used.length === 1 && used[0] === "SystemTemplate" ? [] : [`${relative(file)} uses ${used.join(" and ") || "no template"}`];
    });
    expect(problems).toEqual([]);
  });

  describe("on planted pages", () => {
    const planted: Record<string, string> = {
      "/app/none/page.tsx": `import { Page } from "@/components/ui/page";\nexport default function P() { return <Page><p>Hi</p></Page>; }`,
      "/app/two/page.tsx": `import { IndexTemplate } from "@/components/templates/index-template";\nimport { View } from "./view";\nexport default function P() { return <IndexTemplate header={{ title: "A" }}><View /></IndexTemplate>; }`,
      "/app/two/view.tsx": `import { DetailsTemplate } from "@/components/templates/details-template";\nexport function View() { return <DetailsTemplate header={{ title: "B" }} />; }`,
      "/app/one/page.tsx": `import { View } from "./view";\nexport default function P() { return <View />; }`,
      "/app/one/view.tsx": `import { FormTemplate } from "@/components/templates/form-template";\nexport function View() { return <FormTemplate header={{ title: "New" }} />; }`,
    };
    const read: Read = (file) => planted[file];

    it("fails on a page that uses no template", () => {
      expect([...templatesOf("/app/none/page.tsx", read)]).toEqual([]);
    });

    it("fails on a page that uses two", () => {
      expect([...templatesOf("/app/two/page.tsx", read)].sort()).toEqual(["DetailsTemplate", "IndexTemplate"]);
    });

    it("follows a page into the component that renders its template", () => {
      expect([...templatesOf("/app/one/page.tsx", read)]).toEqual(["FormTemplate"]);
    });
  });
});
