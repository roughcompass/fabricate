// Generates the hero templates' microfrontends and the portal shells
// (converge-templates-and-prototypes, design decision 6):
//
//   npx tsx scripts/generate-heroes.ts [--hero <slug>]... [--skip-shells] [--out <dir>] [--mock]
//   npx tsx scripts/generate-heroes.ts --index-only [--out <dir>]
//
// It runs the Prototypes pipeline's own steps in-process, on an in-memory
// Prototypes store, so it never touches storage/prototypes-pglite or a running
// dev server. For each hero it writes data.ts and every member version's
// source, then the Access and Markets shells, and a manifest with each
// version's gates, planted exemptions, and provenance, to
// src/demo/runtime/generated/ by default. Review the output, then commit it.
// It reads AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN from the environment or
// .env.local; --mock uses the mock models instead, for trying it offline.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { getConfig, setConfig, withOverrides } from "@/lib/config";
import { HERO_SLUGS } from "@/lib/demo/catalog";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { migratePrototypesDatabase, openPrototypesDatabase, setPrototypesDb } from "@/lib/prototypes/db/client";
import { type GeneratedHero, type GeneratedShell, HeroGenerationError, generateHero, generateShell, heroFiles, readGenerated } from "@/lib/prototypes/heroes/generate";
import { generationConfigured } from "@/lib/prototypes/models";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";

const { values } = parseArgs({ options: { hero: { type: "string", multiple: true }, out: { type: "string", default: "src/demo/runtime/generated" }, mock: { type: "boolean", default: false }, "index-only": { type: "boolean", default: false }, "skip-shells": { type: "boolean", default: false } } });

// --index-only writes index.ts, sources.ts, and the manifest again from a committed run's files, without a model.
if (values["index-only"]) {
  const out = path.resolve(values.out!);
  const { heroes, shells } = await readGenerated((file) => fs.readFileSync(path.join(out, file), "utf8"));
  for (const [file, content] of Object.entries(heroFiles(heroes, shells))) fs.writeFileSync(path.join(out, file), content);
  console.log(`Wrote the pages, index, sources, and manifest for ${heroes.length} heroes and ${shells.length} shells in ${path.relative(process.cwd(), out)}.`);
  process.exit(0);
}

for (const file of [".env.local", ".env"]) if (fs.existsSync(file)) process.loadEnvFile(file);

const models = values.mock ? { generate: "mock", plan: "mock", review: "mock", learn: "mock" } : {};
// The run starts empty, runs inline, and isn't bounded by a visitor's daily limit.
setConfig(withOverrides(getConfig(), { prototypes: { examples: false, runner: "inline", dailyVariantLimit: 500, models } }));
const settings = getConfig().prototypes;
if (!generationConfigured(settings)) {
  console.error("No AI Gateway credential: set AI_GATEWAY_API_KEY, or run `vercel env pull` for VERCEL_OIDC_TOKEN. Use --mock to try it without one.");
  process.exit(1);
}

const slugs = values.hero?.length ? values.hero : [...HERO_SLUGS];
const unknown = slugs.filter((slug) => !HERO_SLUGS.includes(slug));
if (unknown.length) {
  console.error(`Not a hero template: ${unknown.join(", ")}. Heroes: ${HERO_SLUGS.join(", ")}.`);
  process.exit(1);
}

const connection = await openPrototypesDatabase({ kind: "memory" });
await migratePrototypesDatabase(connection);
await setPrototypesDb(connection);
const { db } = connection;
const workspace = await ensurePrototypesWorkspace(db, newWorkspaceKey());

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;
const heroes: GeneratedHero[] = [];
const shells: GeneratedShell[] = [];
try {
  for (const slug of slugs) {
    console.log(`[${elapsed()}] ${slug}`);
    const hero = await generateHero(db, workspace.id, slug, settings);
    for (const version of hero.versions) console.log(`[${elapsed()}]   ${version.member} ${version.version}${version.planted.length ? ` (planted: ${version.planted.join(", ")})` : ""}`);
    heroes.push(hero);
  }
  for (const kind of values["skip-shells"] ? [] : (["access", "markets"] as const)) {
    console.log(`[${elapsed()}] ${kind} shell`);
    shells.push(await generateShell(db, workspace.id, kind, settings));
  }
} catch (error) {
  console.error(error instanceof HeroGenerationError ? `Stopped: ${error.message}` : error);
  await connection.close();
  process.exit(1);
}

const out = path.resolve(values.out!);
// A run of some heroes, or without shells, keeps the rest of a committed run's output.
if (fs.existsSync(path.join(out, "manifest.json"))) {
  const committed = await readGenerated((file) => fs.readFileSync(path.join(out, file), "utf8"));
  heroes.push(...committed.heroes.filter((hero) => !heroes.some((fresh) => fresh.slug === hero.slug)));
  shells.push(...committed.shells.filter((shell) => !shells.some((fresh) => fresh.kind === shell.kind)));
  heroes.sort((left, right) => HERO_SLUGS.indexOf(left.slug) - HERO_SLUGS.indexOf(right.slug));
}
for (const [file, content] of Object.entries(heroFiles(heroes, shells))) {
  fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
  fs.writeFileSync(path.join(out, file), content);
}
console.log(`\nWrote ${heroes.length} heroes and ${shells.length} shells to ${path.relative(process.cwd(), out)} in ${elapsed()}. Review them, then commit.`);
await connection.close();
