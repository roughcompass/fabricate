import type { MemoryFile } from "@repo-facts/contract";
import type { Run } from "@/lib/runs/run-records";
import type { Repository } from "@/lib/repositories/repository-records";
import type { Db } from "@/lib/db/client";
import { buildAssessment, buildRepository } from "./builders";
import { manifest } from "./profiles";
import { seedRun } from "./scenarios";

/*
 * A 500-repository Run shaped like the fleet the map is sized for: twenty
 * hosts each composing fifteen applications by Module Federation, twenty
 * libraries the applications share, a hundred operations repositories, and
 * sixty more, fifty of which form ten small runtime systems. That's thirty
 * runtime systems and a hundred and thirty repositories on their own.
 */

const HOSTS = 20;
const APPS_PER_HOST = 15;
const LIBRARIES = 20;
const OPERATIONS = 100;
const SYSTEMS = 10;
const WIDGETS_PER_SYSTEM = 4;
const LOOSE = 10;

const pad = (value: number) => String(value).padStart(2, "0");
const federation = (name: string) => name.replace(/-(.)/g, (_, letter: string) => letter.toUpperCase());

function host(name: string, remotes: readonly string[]): Record<string, MemoryFile> {
  return {
    "package.json": manifest({ name, version: "1.0.0", dependencies: { react: "^18.3.1" }, devDependencies: { webpack: "5.98.0" } }),
    "webpack.config.cjs": `const { ModuleFederationPlugin } = require("webpack").container;\nmodule.exports = { plugins: [new ModuleFederationPlugin({ name: "${federation(name)}", remotes: { ${remotes.map((remote, index) => `${federation(remote)}: "${federation(remote)}@http://127.0.0.1:${10000 + index}/remoteEntry.js"`).join(", ")} } })] };\n`,
  };
}

function remote(name: string, dependencies: Record<string, string>): Record<string, MemoryFile> {
  return {
    "package.json": manifest({ name, version: "1.0.0", dependencies, devDependencies: { webpack: "5.98.0" } }),
    "webpack.config.cjs": `const { ModuleFederationPlugin } = require("webpack").container;\nmodule.exports = { plugins: [new ModuleFederationPlugin({ name: "${federation(name)}", filename: "remoteEntry.js", exposes: { "./App": "./src/App" } })] };\n`,
  };
}

const libraries = (index: number) => Object.fromEntries([0, 7, 13].map((offset) => [`@fleet/lib-${pad((index + offset) % LIBRARIES)}`, "^1.0.0"]));

export interface LargeMap {
  run: Run;
  repositories: Map<string, Repository>;
}

export async function seedLargeMap(db: Db): Promise<LargeMap> {
  const trees = new Map<string, Record<string, MemoryFile>>();
  for (let shell = 0; shell < HOSTS; shell++) {
    const apps = Array.from({ length: APPS_PER_HOST }, (_, app) => `app-${pad(shell)}-${pad(app)}`);
    trees.set(`shell-${pad(shell)}`, host(`shell-${pad(shell)}`, apps));
    apps.forEach((app, index) => trees.set(app, remote(app, { react: "^18.3.1", ...libraries(shell * APPS_PER_HOST + index) })));
  }
  for (let library = 0; library < LIBRARIES; library++) trees.set(`lib-${pad(library)}`, { "package.json": manifest({ name: `@fleet/lib-${pad(library)}`, version: "1.0.0", dependencies: { react: "^18.3.1" } }) });
  for (let index = 0; index < OPERATIONS; index++) trees.set(`ops-${String(index).padStart(3, "0")}`, { "package.json": manifest({ name: `ops-${index}`, version: "1.0.0", dependencies: { react: "^18.3.1", ...libraries(index) } }) });
  for (let system = 0; system < SYSTEMS; system++) {
    const widgets = Array.from({ length: WIDGETS_PER_SYSTEM }, (_, widget) => `widget-${pad(system)}-${widget}`);
    trees.set(`legacy-${pad(system)}`, host(`legacy-${pad(system)}`, widgets));
    for (const widget of widgets) trees.set(widget, remote(widget, { react: "^18.3.1" }));
  }
  for (let index = 0; index < LOOSE; index++) trees.set(`loose-${pad(index)}`, { "package.json": manifest({ name: `loose-${index}`, version: "1.0.0" }) });

  const names = [...trees.keys()];
  const repositories = new Map(names.map((name) => [name, buildRepository(db, { name })]));
  const assessment = buildAssessment(db, { name: "Large map", repositories: [...repositories.values()] });
  const run = await seedRun(db, assessment, [...repositories.values()], names.map((name) => trees.get(name)!));
  return { run, repositories };
}
