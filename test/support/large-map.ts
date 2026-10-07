import type { MemoryFile } from "@repo-facts/contract";
import type { Assessment } from "@/lib/assessments/assessment-records";
import type { RepositorySource } from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { type Application, type AssertionClaim, type Portal, createApplication, ensureLineOfBusiness, ensurePortal, recordAssertion } from "@/lib/ownership/records";
import { buildInitiative, buildSource } from "./builders";
import { manifest } from "./profiles";
import { seedAssessment } from "./scenarios";

/*
 * A 500-repository Run shaped like the fleet the map is sized for: five Lines
 * of Business with four portals each, every portal's host composing fifteen
 * applications by Module Federation, twenty libraries the applications share,
 * a hundred claimed repositories in no portal, and sixty unclaimed ones, fifty
 * of which form ten runtime systems. Every tenth application's SEAL is also
 * claimed in the next portal, often one of another Line of Business.
 */

const LINES = 5;
const PORTALS_PER_LINE = 4;
const APPS_PER_PORTAL = 15;
const LIBRARIES = 20;
const UNPORTALED = 100;
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
  assessment: Assessment;
  sources: Map<string, RepositorySource>;
  portals: Portal[];
  /** The claimed applications, by SEAL ID: each SEAL ID here names one application. */
  applications: Map<string, Application>;
}

export async function seedLargeMap(db: Db): Promise<LargeMap> {
  const trees = new Map<string, Record<string, MemoryFile>>();
  for (let portal = 0; portal < LINES * PORTALS_PER_LINE; portal++) {
    const apps = Array.from({ length: APPS_PER_PORTAL }, (_, app) => `app-${pad(portal)}-${pad(app)}`);
    trees.set(`shell-${pad(portal)}`, host(`shell-${pad(portal)}`, apps));
    apps.forEach((app, index) => trees.set(app, remote(app, { react: "^18.3.1", ...libraries(portal * APPS_PER_PORTAL + index) })));
  }
  for (let library = 0; library < LIBRARIES; library++) trees.set(`lib-${pad(library)}`, { "package.json": manifest({ name: `@fleet/lib-${pad(library)}`, version: "1.0.0", dependencies: { react: "^18.3.1" } }) });
  for (let index = 0; index < UNPORTALED; index++) trees.set(`ops-${String(index).padStart(3, "0")}`, { "package.json": manifest({ name: `ops-${index}`, version: "1.0.0", dependencies: { react: "^18.3.1", ...libraries(index) } }) });
  for (let system = 0; system < SYSTEMS; system++) {
    const widgets = Array.from({ length: WIDGETS_PER_SYSTEM }, (_, widget) => `widget-${pad(system)}-${widget}`);
    trees.set(`legacy-${pad(system)}`, host(`legacy-${pad(system)}`, widgets));
    for (const widget of widgets) trees.set(widget, remote(widget, { react: "^18.3.1" }));
  }
  for (let index = 0; index < LOOSE; index++) trees.set(`loose-${pad(index)}`, { "package.json": manifest({ name: `loose-${index}`, version: "1.0.0" }) });

  const names = [...trees.keys()];
  const sources = new Map(names.map((name) => [name, buildSource(db, { name })]));
  const initiative = buildInitiative(db, { name: "Large map", sources: [...sources.values()] });
  const assessment = await seedAssessment(db, initiative, [...sources.values()], names.map((name) => trees.get(name)!));
  return { assessment, sources, ...claimLargeMap(db, sources) };
}

function claimLargeMap(db: Db, sources: Map<string, RepositorySource>): { portals: Portal[]; applications: Map<string, Application> } {
  const claim = (input: AssertionClaim) => recordAssertion(db, { ...input, source: "person", providedBy: "ana@example.com" });
  const lines = Array.from({ length: LINES }, (_, line) => ensureLineOfBusiness(db, `Line ${line + 1}`));
  const portals = Array.from({ length: LINES * PORTALS_PER_LINE }, (_, portal) => ensurePortal(db, `Portal ${pad(portal)}`));
  const applications = new Map<string, Application>();
  const link = (repository: string, sealId: string, name: string, line: number) => {
    const application = applications.get(sealId) ?? createApplication(db, { sealId, name });
    applications.set(sealId, application);
    claim({ attribute: "application", repository: sources.get(repository)!.id, application: application.id });
    return { application, line };
  };
  const aligned = new Set<number>();
  const align = (entry: ReturnType<typeof link>) => {
    if (aligned.has(entry.application.id)) return entry.application;
    aligned.add(entry.application.id);
    claim({ attribute: "line_of_business", application: entry.application.id, lineOfBusiness: lines[entry.line]!.id });
    return entry.application;
  };

  for (const [index, portal] of portals.entries()) {
    const line = Math.floor(index / PORTALS_PER_LINE);
    const shell = align(link(`shell-${pad(index)}`, `SEAL-S${pad(index)}`, `Shell ${pad(index)}`, line));
    claim({ attribute: "owner", portal: portal.id, application: shell.id });
    claim({ attribute: "host", portal: portal.id, repository: sources.get(`shell-${pad(index)}`)!.id });
    for (let pair = 0; pair < APPS_PER_PORTAL; pair += 2) {
      const sealId = `SEAL-A${pad(index)}${pad(pair)}`;
      let application = null;
      for (const app of [pair, pair + 1].filter((value) => value < APPS_PER_PORTAL)) application = align(link(`app-${pad(index)}-${pad(app)}`, sealId, `App ${pad(index)}.${pad(pair)}`, line));
      claim({ attribute: "portal", operation: "add", application: application!.id, portal: portal.id });
      // Every fifth pair also appears in the next portal, which is often another Line of Business's.
      if (pair % 10 === 0) claim({ attribute: "portal", operation: "add", application: application!.id, portal: portals[(index + 1) % portals.length]!.id });
    }
  }
  for (let library = 0; library < LIBRARIES; library++) align(link(`lib-${pad(library)}`, "SEAL-DS", "Design system", 0));
  for (let index = 0; index < UNPORTALED; index++) align(link(`ops-${String(index).padStart(3, "0")}`, `SEAL-O${pad(Math.floor(index / 4))}`, `Operations ${Math.floor(index / 4)}`, index % LINES));
  return { portals, applications };
}
