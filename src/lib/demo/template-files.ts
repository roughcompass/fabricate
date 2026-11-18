import { GENERATED_SOURCES } from "@/demo/runtime/generated/sources";
import { STYLES_MODULE } from "@/lib/prototypes/gates";
import { RUNTIME } from "@/lib/prototypes/render";
import { BRANDS, type GroupMember, type Template, shellOf } from "./catalog";
import { scaffoldCommand } from "./preview";

/**
 * The files preview mode's Code tab shows (template-preview spec, "The Code
 * tab shows each template's real files"): a package.json, a
 * microfrontends.json describing the group in the shape of Vercel's
 * microfrontends configuration, a README, the shared data, and each child
 * microfrontend's real Salt source at its default version, the source its
 * reference deployment renders, with its CSS module when it has one. They are
 * the same on every visit.
 */

export interface TemplateFile {
  readonly path: string;
  readonly language: "json" | "tsx" | "css" | "markdown";
  readonly content: string;
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function routePaths(member: GroupMember): string[] {
  switch (member.routing.kind) {
    case "route":
      return [`/${member.routing.path}`, `/${member.routing.path}/:path*`];
    case "slot":
      return [`/${member.routing.route}`];
    case "shell":
      return [];
  }
}

function microfrontendsJson(template: Template): string {
  const shell = shellOf(template.app);
  const applications: Record<string, unknown> = {
    [shell.id]: { default: true, version: shell.defaultVersion, owner: shell.owner, development: { fallback: "production" } },
  };
  for (const member of template.app.members.filter((entry) => entry.role === "child")) {
    applications[member.id] = {
      version: member.defaultVersion,
      owner: member.owner,
      routing: member.routing.kind === "slot" ? [{ paths: routePaths(member), slot: member.routing.slot }] : [{ paths: routePaths(member) }],
    };
  }
  return json({ $schema: "https://deweb.example/schemas/microfrontends.json", portal: BRANDS[template.brand].portalName, applications });
}

function readme(template: Template): string {
  const members = template.app.members.filter((member) => member.role === "child");
  return [
    `# ${template.title}`,
    "",
    template.description,
    "",
    "## Get started",
    "",
    "```sh",
    scaffoldCommand(template.slug),
    "cd my-app",
    "npm run dev",
    "```",
    "",
    "## Routes",
    "",
    ...template.app.routes.map((route) => `- \`/${route.path}\`: ${route.label}`),
    "",
    "## Microfrontends",
    "",
    `- \`${shellOf(template.app).id}\`: the ${BRANDS[template.brand].portalName} portal shell, the group's default application`,
    ...members.map((member) => `- \`${member.id}\`: ${member.name} ${member.defaultVersion}, owned by ${member.owner}`),
    "",
  ].join("\n");
}

/** A template's package.json: its microfrontends, React, the portal runtime interface, and the Salt packages its source imports, at the versions DE FabLab renders with. */
function packageJson(template: Template, sources: readonly string[]): string {
  const children = template.app.members.filter((member) => member.role === "child");
  const packages = RUNTIME.packages as Record<string, string>;
  const salt = [...new Set(sources.flatMap((source) => [...source.matchAll(/from\s+["'](@salt-ds\/[a-z-]+)["']/g)].map((match) => match[1]!)))].sort();
  return json({
    name: template.slug,
    version: template.version,
    private: true,
    scripts: { dev: "deweb dev", build: "deweb build", test: "deweb test" },
    dependencies: {
      ...Object.fromEntries([shellOf(template.app), ...children].map((member) => [`@deweb/${member.id}`, member.defaultVersion])),
      "@deweb/portal": "1.0.0",
      react: packages.react,
      "react-dom": packages["react-dom"],
      ...Object.fromEntries(salt.map((name) => [name, packages[name] ?? "latest"])),
    },
    devDependencies: { "@deweb/cli": "4.2.0", "@deweb/microfrontends": "2.8.1" },
  });
}

/** The template's files, in the order the Code tab lists them; the first is selected by default. A member's CSS module follows its source. */
export function templateFiles(template: Template): TemplateFile[] {
  const sources = GENERATED_SOURCES[template.slug];
  const children = template.app.members.filter((member) => member.role === "child");
  // A member file imports its CSS module by its own name, as a project with one file per microfrontend would.
  const code = (member: GroupMember) => (sources?.members[member.id]?.[member.defaultVersion] ?? "").replaceAll(`"${STYLES_MODULE}"`, `"./${member.id}.module.css"`);
  return [
    { path: "package.json", language: "json", content: packageJson(template, children.map(code)) },
    { path: "microfrontends.json", language: "json", content: microfrontendsJson(template) },
    { path: "README.md", language: "markdown", content: readme(template) },
    { path: "src/data.ts", language: "tsx", content: sources?.data ?? "" },
    ...children.flatMap((member): TemplateFile[] => {
      const styles = sources?.memberStyles[member.id]?.[member.defaultVersion];
      return [{ path: `src/${member.id}.tsx`, language: "tsx", content: code(member) }, ...(styles ? [{ path: `src/${member.id}.module.css`, language: "css" as const, content: styles }] : [])];
    }),
  ];
}
