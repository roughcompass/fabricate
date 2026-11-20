import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { analyze } from "@repo-facts/bundle";
import { type JsonObject, MemoryReader } from "@repo-facts/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/applications/[slug]/composition/route";
import { buildComposition, compositionOf } from "@/lib/applications/composition";
import { entryPath } from "@/lib/applications/microfrontends";
import { getApplication } from "@/lib/applications/records";
import { type FrontendRegistryConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import { previewBuilds, previewPreparations, surveys } from "@/lib/db/schema";
import { immediate } from "@/lib/db/client";
import { insertProfile } from "@/lib/profiles/profile-records";
import { surveyRefFor } from "@/lib/acquisition/mirror";
import { moveSurvey, pinSurvey } from "@/lib/surveys/records";
import { buildProfile } from "@/lib/profiles/schema";
import type { Fact, FactDocument } from "@/lib/profiles/states";
import { decidedPreparation, onboard, qualifyingVerdict } from "../support/applications";
import { buildRepository } from "../support/builders";
import { saltEntry } from "../support/catalog";
import { useAppDb } from "../support/next";
import { publishFiles } from "../support/previews";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

/*
 * What a build is composed of, from the Profile of its commit
 * (restore-toolbar-tools-and-branch-previews, design decisions 7 and 9,
 * tasks 9.1 and 11.1): its Module Federation remotes, import-map entries,
 * single-spa roles, the containers it is, and whether it renders a Salt
 * provider, which decides whether Settings offers the theme switch.
 */

const fact = (key: string, value: Fact["value"], evidence: string[] = ["e1"]): Fact => ({ key, state: "observed", value, evidence, rule: "test" });

function profile(categories: Record<string, Fact[]>, evidence: Record<string, string> = { e1: "src/index.html" }): FactDocument {
  return {
    detector_release: "0.7.0",
    categories: Object.fromEntries(Object.entries(categories).map(([id, facts]) => [id, { state: facts.length ? "observed" : "absent", facts, search: { complete: true, skipped: [], surface: [], rules: [] } }])),
    evidence: Object.fromEntries(Object.entries(evidence).map(([id, path]) => [id, { path, location: { kind: "lines", start: 1, end: 1 } }])),
  };
}

/** Quotes desk's Profile, as Surveyor reports it: a Module Federation host, an import map, a single-spa root configuration, and Salt with its provider. */
const QUOTES_DESK = profile({
  composition: [
    fact("module-federation:quotesDesk", {
      mechanism: "module-federation",
      package: "@rspack/core",
      api: "ModuleFederationPluginV1",
      name: { kind: "literal", value: "quotesDesk" },
      remotes: [{ alias: "quotesPanel", federation_name: "quotesPanel", entry: { kind: "literal", value: "http://127.0.0.1:9311/remoteEntry.js" } }],
      exposes: [],
      shared: ["@salt-ds/core", "react", "react-dom"],
    }),
    fact("import-map:@fixtures/quotes-panel", { mechanism: "import-map", specifier: "@fixtures/quotes-panel", url: "http://127.0.0.1:9312/ticker.js", source: "src/index.html" }),
    fact("single-spa:root-config", { mechanism: "single-spa", role: "root-config" }),
  ],
  design_systems: [fact("salt", { catalog: "salt", name: "Salt", packages: [], imported: true, theme_stylesheet: true, provider: true })],
});

/** Orders portal's: none of these. */
const ORDERS_PORTAL = profile({ composition: [], design_systems: [] });

describe("a build's composition", () => {
  it("reads Quotes desk's remote, import-map entry, root configuration, and Salt provider", () => {
    expect(compositionOf(QUOTES_DESK)).toEqual({
      packageName: null,
      remotes: [{ alias: "quotesPanel", container: "quotesPanel", entry: "http://127.0.0.1:9311/remoteEntry.js" }],
      imports: [{ specifier: "@fixtures/quotes-panel", url: "http://127.0.0.1:9312/ticker.js" }],
      singleSpa: { rootConfig: true, application: false },
      containers: [],
      saltProvider: true,
    });
  });

  it("offers no theme switch for Orders portal, whose Profile shows no Salt provider, or for a build with no Profile", () => {
    expect(compositionOf(ORDERS_PORTAL).saltProvider).toBe(false);
    expect(compositionOf(null).saltProvider).toBe(false);
    // Salt declared and imported, but never rendered through its provider, isn't enough.
    const declared = profile({ design_systems: [fact("salt", { catalog: "salt", name: "Salt", packages: [], imported: true, theme_stylesheet: false, provider: false })] });
    expect(compositionOf(declared).saltProvider).toBe(false);
  });

  it("names a remote a host loads by code with no address, and the containers a remote is", () => {
    const shell = profile({
      composition: [
        fact("module-federation:mfShell", {
          mechanism: "module-federation",
          name: { kind: "literal", value: "mfShell" },
          remotes: [
            { alias: "mfAdmin", federation_name: "mfAdmin", entry: { kind: "literal", value: "http://127.0.0.1:9101/remoteEntry.js" } },
            { alias: "mfBilling", federation_name: null, entry: { kind: "unresolved", reason: "computed", detail: "The remote is loaded by code" } },
          ],
          exposes: [],
        }),
        fact("module-federation:quotesPanel", { mechanism: "module-federation", name: { kind: "literal", value: "quotesPanel" }, remotes: [], exposes: ["./Quotes"] }),
      ],
    });
    const composition = compositionOf(shell);
    expect(composition.remotes).toEqual([
      { alias: "mfAdmin", container: "mfAdmin", entry: "http://127.0.0.1:9101/remoteEntry.js" },
      { alias: "mfBilling", container: null, entry: null },
    ]);
    expect(composition.containers).toEqual([{ name: "quotesPanel", exposes: ["./Quotes"] }]);
  });

  it("takes only the facts about the package in a monorepo's directory", () => {
    const monorepo = profile(
      { design_systems: [fact("salt", { catalog: "salt", name: "Salt", packages: [], provider: true }, ["admin"])] },
      { admin: "apps/admin/src/main.tsx" },
    );
    expect(compositionOf(monorepo, "apps/admin").saltProvider).toBe(true);
    expect(compositionOf(monorepo, "apps/orders").saltProvider).toBe(false);
  });
});

/** A fixture application's committed files, as a survey reads them. */
function fixtureFiles(name: string): Record<string, string> {
  const root = path.resolve("test/fixtures/apps", name);
  const files: Record<string, string> = {};
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", "dist"].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[path.relative(root, full)] = fs.readFileSync(full, "utf8");
    }
  };
  walk(root);
  return files;
}

describe("the composition endpoint", () => {
  const original = getConfig();
  const app = useAppDb();
  let storage: string;
  let config: FrontendRegistryConfig;

  beforeEach(() => {
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "composition-")));
  });
  afterEach(() => {
    setConfig(original);
    fs.rmSync(storage, { recursive: true, force: true });
  });

  /**
   * The fixture +fixture+ onboarded as +name+, its first build published with
   * +files+, and the Profile that decided it surveyed from the fixture's
   * sources against Salt's Reference Catalog entry, as preparation would.
   */
  async function seeded(fixture: string, name: string, files: Record<string, string>) {
    const repository = buildRepository(app.db, { name: fixture, cloneUrl: `https://git.example.com/fixtures/${fixture}.git` });
    config = withOverrides(original, { previews: { enabled: true, trustedSources: [...(config?.previews.trustedSources ?? []), repository.canonicalUrl], storage } });
    setConfig(config);
    const preparation = decidedPreparation(app.db, repository, [qualifyingVerdict(".", { name: `@fixtures/${fixture}` })]);
    const survey = app.db.select().from(surveys).where(eq(surveys.id, app.db.select().from(previewPreparations).where(eq(previewPreparations.id, preparation.id)).get()!.surveyId!)).get()!;
    const factDocument = await analyze(MemoryReader.fromFiles(fixtureFiles(fixture), { commit: preparation.commitSha, budgets: config.analysis }), { entries: [saltEntry() as unknown as JsonObject] as never });
    // Written by its survey while it runs, as the worker writes it.
    const running = pinSurvey(app.db, moveSurvey(app.db, survey, "running", { attempts: 1 }), { treeSha: null, internalRef: surveyRefFor(survey.publicId) });
    immediate(app.db, (tx) => {
      insertProfile(tx, { survey: running, document: buildProfile({ repository: repository.publicId, commit: preparation.commitSha, surveyorRelease: survey.surveyorRelease, configurationDigest: survey.configurationDigest, factDocument }) });
      moveSurvey(tx, running, "succeeded", {});
    });
    const created = onboard(app.db, config, repository, { name, preparation });
    publishFiles(app.db, config, app.db.select().from(previewBuilds).where(eq(previewBuilds.id, created.latestPreviewId!)).get()!, { "index.html": `<h1>${name}</h1>`, ...files });
    return getApplication(app.db, created.slug);
  }

  const request = (slug: string, query = "") => GET(new Request(`http://localhost/api/applications/${slug}/composition${query}`), { params: Promise.resolve({ slug }) });

  it("answers Quotes desk's composition facts and Quotes panel's build as a candidate for both microfrontends, with its entry files", async () => {
    await seeded("quotes-panel", "Quotes panel", { "remoteEntry.js": "var quotesPanel;", "ticker.js": "export async function mount() {}" });
    const desk = await seeded("quotes-desk", "Quotes desk", {});
    expect(buildComposition(app.db, desk.current!.preview, ".")).toMatchObject({ packageName: "@fixtures/quotes-desk", saltProvider: true, singleSpa: { rootConfig: true } });

    const response = await request("quotes-desk");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { composition: { remotes: unknown[] }; microfrontends: { id: string; entry: string; entryPath: string; candidates: { application: { slug: string }; label: string; build: unknown; hasEntry: boolean }[] }[] };
    expect(body.composition.remotes).toEqual([{ alias: "quotesPanel", container: "quotesPanel", entry: "http://127.0.0.1:9311/remoteEntry.js" }]);
    expect(body.microfrontends.map((microfrontend) => [microfrontend.id, microfrontend.entryPath])).toEqual([
      ["remote:quotesPanel", "remoteEntry.js"],
      ["import:@fixtures/quotes-panel", "ticker.js"],
    ]);
    for (const microfrontend of body.microfrontends) {
      expect(microfrontend.candidates).toHaveLength(1);
      expect(microfrontend.candidates[0]).toMatchObject({ application: { slug: "quotes-panel" }, label: "main", hasEntry: true });
    }
  });

  it("says a candidate build lacks the entry's file, and offers no candidate when no application builds a microfrontend", async () => {
    await seeded("quotes-panel", "Quotes panel", { "remoteEntry.js": "var quotesPanel;" });
    await seeded("quotes-desk", "Quotes desk", {});
    const body = (await (await request("quotes-desk")).json()) as { microfrontends: { id: string; candidates: { hasEntry: boolean }[] }[] };
    const byId = Object.fromEntries(body.microfrontends.map((microfrontend) => [microfrontend.id, microfrontend.candidates.map((candidate) => candidate.hasEntry)]));
    expect(byId).toEqual({ "remote:quotesPanel": [true], "import:@fixtures/quotes-panel": [false] });

    // Quotes panel itself loads no microfrontend.
    expect(((await (await request("quotes-panel")).json()) as { microfrontends: unknown[] }).microfrontends).toEqual([]);
  });

  it("answers not found for an unknown application or saved preview, and while previews are off", async () => {
    await seeded("quotes-desk", "Quotes desk", {});
    expect((await request("no-such-application")).status).toBe(404);
    expect((await request("quotes-desk", "?preview=no-such-preview")).status).toBe(404);
    setConfig(withOverrides(original, { previews: { enabled: false } }));
    expect((await request("quotes-desk")).status).toBe(404);
  });
});

describe("an entry's path in a build", () => {
  it("is its address's path, for an address on any host or the Frontend Registry's own", () => {
    expect(entryPath("http://127.0.0.1:9311/remoteEntry.js")).toBe("remoteEntry.js");
    expect(entryPath("http://127.0.0.1:9102/assets/remoteEntry.js")).toBe("assets/remoteEntry.js");
    expect(entryPath("/remotes/admin/remoteEntry.js")).toBe("remotes/admin/remoteEntry.js");
    expect(entryPath(null)).toBeNull();
    expect(entryPath("http://127.0.0.1:9311/")).toBeNull();
    expect(entryPath("data:text/javascript,x")).toBeNull();
  });
});
