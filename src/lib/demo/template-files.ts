import { BRANDS, type GroupMember, type Template, shellOf } from "./catalog";
import { scaffoldCommand } from "./preview";

/**
 * The files preview mode's Code tab shows (template-preview spec, design.md
 * decision 19). They are generated from the catalog, so they are the same on
 * every visit: a package.json, a microfrontends.json describing the group in
 * the shape of Vercel's microfrontends configuration, one illustrative source
 * file per child microfrontend at its default version, and a README. Nothing
 * here is ever built or run.
 */

export interface TemplateFile {
  readonly path: string;
  readonly language: "json" | "tsx" | "markdown";
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

function packageJson(template: Template): string {
  const children = template.app.members.filter((member) => member.role === "child");
  return json({
    name: template.slug,
    version: template.version,
    private: true,
    scripts: { dev: "deweb dev", build: "deweb build", test: "deweb test" },
    dependencies: Object.fromEntries([shellOf(template.app), ...children].map((member) => [`@deweb/${member.id}`, member.defaultVersion])),
    devDependencies: { "@deweb/cli": "4.2.0", "@deweb/microfrontends": "2.8.1" },
  });
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

function componentName(member: GroupMember): string {
  return member.id.replace(/(^|-)([a-z])/g, (_, __, letter: string) => letter.toUpperCase());
}

function sourceFile(template: Template, member: GroupMember): string {
  const version = member.versions.find((entry) => entry.version === member.defaultVersion)!;
  const name = componentName(member);
  const where = member.routing.kind === "slot" ? `the ${member.routing.slot} slot on /${member.routing.route}` : member.routing.kind === "route" ? `/${member.routing.path}` : "every route";
  const lines = [
    `// ${member.name} ${member.defaultVersion}: ${version.summary}.`,
    `// Owned by ${member.owner}; serves ${where} in the ${BRANDS[template.brand].portalName} portal.`,
    `import { defineMicrofrontend, useSession${member.subscribes?.length ? ", useSubscription" : ""}${member.publishes?.length ? ", usePublish" : ""} } from "@deweb/microfrontends";`,
    "",
    `export function ${name}() {`,
    "  const session = useSession();",
  ];
  for (const topic of member.publishes ?? []) lines.push(`  const publish = usePublish(${JSON.stringify(topic)});`);
  for (const topic of member.subscribes ?? []) lines.push(`  useSubscription(${JSON.stringify(topic)}, (payload) => console.info(${JSON.stringify(topic)}, payload));`);
  lines.push(`  return <section aria-label=${JSON.stringify(member.name)} data-theme={session.theme}>{/* ${version.summary} */}</section>;`, "}", "");
  lines.push(`export default defineMicrofrontend({`, `  name: ${JSON.stringify(member.id)},`, `  version: ${JSON.stringify(member.defaultVersion)},`, `  component: ${name},`, "});", "");
  return lines.join("\n");
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

/** The template's files, in the order the Code tab lists them; the first is selected by default. */
export function templateFiles(template: Template): TemplateFile[] {
  return [
    { path: "package.json", language: "json", content: packageJson(template) },
    { path: "microfrontends.json", language: "json", content: microfrontendsJson(template) },
    { path: "README.md", language: "markdown", content: readme(template) },
    ...template.app.members.filter((member) => member.role === "child").map((member): TemplateFile => ({ path: `apps/${member.id}/src/index.tsx`, language: "tsx", content: sourceFile(template, member) })),
  ];
}
