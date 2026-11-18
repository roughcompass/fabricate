// Builds the templates (update-templates-salt-quality, design decision 3):
//
//   npx tsx scripts/build-templates.ts                       # check every template and shell, then write
//   npx tsx scripts/build-templates.ts --check [--template <slug>]... [--shell access|markets]...
//
// Every built-in template's microfrontend versions and data, and both portal
// shells, are committed Salt source under src/demo/runtime/generated/. This
// gates every file with no exemptions, composes each template's main route
// into one page, and writes the pages, index.ts, sources.ts, and
// manifest.json. --check gates the named templates and shells, or all of them,
// and writes nothing, so templates can be checked while others are written.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { TEMPLATES } from "@/lib/demo/catalog";
import { GENERATED_DIR, SHELL_KINDS, type ShellKind, TemplateBuildError, buildTemplates, builtFiles } from "@/lib/prototypes/heroes/build";

const { values } = parseArgs({ options: { check: { type: "boolean", default: false }, template: { type: "string", multiple: true }, shell: { type: "string", multiple: true } } });

const slugs = values.template;
const shells = values.shell as ShellKind[] | undefined;
const unknown = [...(slugs ?? []).filter((slug) => !TEMPLATES.some((template) => template.slug === slug)), ...(shells ?? []).filter((kind) => !SHELL_KINDS.includes(kind))];
if (unknown.length) {
  console.error(`Unknown: ${unknown.join(", ")}. Templates: ${TEMPLATES.map((template) => template.slug).join(", ")}. Shells: ${SHELL_KINDS.join(", ")}.`);
  process.exit(1);
}
if (!values.check && (slugs || shells)) {
  console.error("Write every template at once: --template and --shell are for --check.");
  process.exit(1);
}

const started = Date.now();
try {
  const built = await buildTemplates(undefined, slugs || shells ? { slugs: slugs ?? [], shells: shells ?? [] } : undefined);
  const versions = built.templates.reduce((count, template) => count + template.versions.length, 0);
  const summary = `${built.templates.length} templates (${versions} microfrontend versions and ${built.templates.length} pages) and ${built.shells.length} shells`;
  if (values.check) {
    console.log(`Checked ${summary}: every gate passed, in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  } else {
    for (const [file, content] of Object.entries(builtFiles(built.templates, built.shells))) {
      fs.mkdirSync(path.dirname(path.join(GENERATED_DIR, file)), { recursive: true });
      fs.writeFileSync(path.join(GENERATED_DIR, file), content);
    }
    console.log(`Built ${summary} in ${GENERATED_DIR}, in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  }
} catch (error) {
  console.error(error instanceof TemplateBuildError ? error.message : error);
  process.exit(1);
}
