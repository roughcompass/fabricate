import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigurationError, type Settings, loadConfig, withOverrides } from "@/lib/config";

const shared: Settings = {
  allowedRoots: [],
  deniedRoots: [],
  gitTimeoutSeconds: 120,
  gitLockTimeoutSeconds: 300,
  workerConcurrency: 3,
  database: "storage/frontend-registry.sqlite3",
  repositoryStorage: "storage/repositories",
  gitCredentialHelper: null,
  analysis: { maxBlobBytes: 1024, maxLockfileBytes: 2048, maxFiles: 10, maxTotalBytes: 4096 },
  demo: { enabled: false },
  profiling: { checkMinutes: 60 },
  catalog: { registry: "https://registry.npmjs.org/" },
  adoption: { snapshotDays: 7, rarelyUsedPercentile: 25 },
  previews: { enabled: false, browser: null, trustedSources: [], nodeVersions: {}, storage: "storage/previews", concurrency: 1, timeoutMinutes: 15, maxOutputBytes: 209_715_200, maxStorageBytes: 5_368_709_120, refCacheSeconds: 60 },
};

describe("configuration", () => {
  let workspace: string;
  let appRoot: string;
  let fleetKit: string;

  beforeEach(() => {
    workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "frontend-registry-config-")));
    appRoot = path.join(workspace, "frontend-registry");
    fleetKit = path.join(workspace, "fleet-kit");
    for (const dir of [appRoot, fleetKit, path.join(workspace, "fleet")]) fs.mkdirSync(dir);
  });

  afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const load = (file: unknown = { shared }, env: Record<string, string> = {}, environment = "test" as const) =>
    loadConfig({ appRoot, environment, env, file });

  it("merges the environment section over shared settings and resolves paths from the app root", () => {
    const config = load({ shared, test: { allowedRoots: ["../fleet"], workerConcurrency: 1 } });

    expect(config.allowedRoots).toEqual([path.join(workspace, "fleet")]);
    expect(config.workerConcurrency).toBe(1);
    expect(config.database).toBe(path.join(appRoot, "storage/frontend-registry.sqlite3"));
    expect(config.analysis).toEqual({ maxBlobBytes: 1024, maxLockfileBytes: 2048, maxFiles: 10, maxTotalBytes: 4096 });
  });

  it("always denies fleet-kit, even when no denied roots are configured", () => {
    expect(load().deniedRoots).toContain(fleetKit);
  });

  it("cannot drop fleet-kit through an environment variable or an override", () => {
    const fromEnv = load({ shared }, { FRONTEND_REGISTRY_DENIED_ROOTS: path.join(workspace, "other") });
    expect(fromEnv.deniedRoots).toEqual([path.join(workspace, "other"), fleetKit]);

    const overridden = withOverrides(fromEnv, { deniedRoots: [] });
    expect(overridden.deniedRoots).toEqual([fleetKit]);
    expect(overridden.mandatoryDeniedRoots).toEqual([fleetKit]);
  });

  it("denies the real location of a symlinked fleet-kit tree", () => {
    const real = path.join(workspace, "hidden-answers");
    fs.renameSync(fleetKit, real);
    fs.symlinkSync(real, fleetKit);

    expect(load().deniedRoots).toEqual([fleetKit, real]);
  });

  it.each([
    ["directly inside fleet-kit", () => "../fleet-kit/data"],
    ["as the fleet-kit root", () => "../fleet-kit"],
    ["through a fleet-kit path segment elsewhere", () => "/opt/fleet-kit/data"],
  ])("rejects an allowed root %s", (_label, root) => {
    expect(() => load({ shared, test: { allowedRoots: [root()] } })).toThrow(ConfigurationError);
  });

  it("rejects an allowed root that resolves into fleet-kit through a symlink", () => {
    fs.symlinkSync(fleetKit, path.join(workspace, "innocent"));

    expect(() => load({ shared, test: { allowedRoots: ["../innocent"] } })).toThrow(/protected fleet-kit/);
    expect(() => withOverrides(load(), { allowedRoots: ["../innocent"] })).toThrow(ConfigurationError);
  });

  it("applies typed environment overrides", () => {
    const config = load({ shared }, {
      FRONTEND_REGISTRY_ALLOWED_ROOTS: [path.join(workspace, "fleet"), path.join(workspace, "more")].join(path.delimiter),
      FRONTEND_REGISTRY_GIT_TIMEOUT: "30",
      FRONTEND_REGISTRY_WORKER_CONCURRENCY: "8",
      FRONTEND_REGISTRY_MAX_FILES: "99",
      FRONTEND_REGISTRY_GIT_CREDENTIAL_HELPER: "osxkeychain",
    });

    expect(config.allowedRoots).toEqual([path.join(workspace, "fleet"), path.join(workspace, "more")]);
    expect(config.gitTimeoutSeconds).toBe(30);
    expect(config.workerConcurrency).toBe(8);
    expect(config.analysis.maxFiles).toBe(99);
    expect(config.gitCredentialHelper).toBe("osxkeychain");
  });

  it.each([
    ["a non-numeric integer", { FRONTEND_REGISTRY_GIT_TIMEOUT: "soon" }],
    ["a negative integer", { FRONTEND_REGISTRY_MAX_FILES: "-1" }],
    ["zero", { FRONTEND_REGISTRY_WORKER_CONCURRENCY: "0" }],
  ])("rejects %s from the environment", (_label, env) => {
    expect(() => load({ shared }, env)).toThrow(ConfigurationError);
  });

  it("rejects unknown, missing, and blank settings", () => {
    expect(() => load({ shared: { ...shared, surprise: true } })).toThrow(/Invalid config/);
    const { workerConcurrency: _omitted, ...missing } = shared;
    expect(() => load({ shared: missing })).toThrow(ConfigurationError);
    expect(() => load({ shared, test: { database: " " } })).toThrow(ConfigurationError);
    expect(() => load({ shared, staging: {} })).toThrow(ConfigurationError);
  });

  it("is deeply immutable", () => {
    const config = load();

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.deniedRoots)).toBe(true);
    expect(() => (config.deniedRoots as string[]).pop()).toThrow(TypeError);
  });

  it("loads the committed config file for every environment", () => {
    for (const environment of ["development", "test", "production"] as const) {
      const config = loadConfig({ appRoot: process.cwd(), environment, env: {} });
      expect(config.deniedRoots).toContain(path.join(path.dirname(process.cwd()), "fleet-kit"));
    }
  });

  describe("names from before the rename, read for one release", () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    const withEnv = (env: Record<string, string>, environment?: "test") => loadConfig({ appRoot, environment, env, file: { shared }, warn });
    const writeConfig = (name: string, settings: Partial<Settings>) => {
      fs.mkdirSync(path.join(appRoot, "config"), { recursive: true });
      fs.writeFileSync(path.join(appRoot, "config", name), JSON.stringify({ shared: { ...shared, ...settings } }));
    };

    beforeEach(() => {
      warnings.length = 0;
    });

    it("reads FRONTEND_REGISTRY_* variables without a warning", () => {
      expect(withEnv({ FRONTEND_REGISTRY_WORKER_CONCURRENCY: "7", FRONTEND_REGISTRY_ENV: "production" }, undefined)).toMatchObject({ workerConcurrency: 7, environment: "production" });
      expect(warnings).toEqual([]);
    });

    it("reads an old FABRICATE_* variable when its new name is unset, and warns that it's deprecated", () => {
      const config = withEnv({ FABRICATE_WORKER_CONCURRENCY: "6", FABRICATE_PREVIEWS: "true", FABRICATE_ENV: "production" }, undefined);

      expect(config).toMatchObject({ workerConcurrency: 6, environment: "production", previews: { enabled: true } });
      expect(warnings).toEqual([
        "FABRICATE_ENV is deprecated and stops working in the next release. Set FRONTEND_REGISTRY_ENV instead.",
        "FABRICATE_WORKER_CONCURRENCY is deprecated and stops working in the next release. Set FRONTEND_REGISTRY_WORKER_CONCURRENCY instead.",
        "FABRICATE_PREVIEWS is deprecated and stops working in the next release. Set FRONTEND_REGISTRY_PREVIEWS instead.",
      ]);
    });

    it("prefers the new name when both are set, and warns that the old one is ignored", () => {
      expect(withEnv({ FRONTEND_REGISTRY_MAX_FILES: "12", FABRICATE_MAX_FILES: "99" }, "test").analysis.maxFiles).toBe(12);
      expect(warnings).toEqual(["FABRICATE_MAX_FILES is ignored because FRONTEND_REGISTRY_MAX_FILES is set. Remove FABRICATE_MAX_FILES."]);
    });

    it("reads config/frontend-registry.json", () => {
      writeConfig("frontend-registry.json", { workerConcurrency: 5 });

      expect(loadConfig({ appRoot, environment: "test", env: {}, warn }).workerConcurrency).toBe(5);
      expect(warnings).toEqual([]);
    });

    it("falls back to config/fabricate.json when config/frontend-registry.json is missing, with a warning", () => {
      writeConfig("fabricate.json", { workerConcurrency: 4 });

      expect(loadConfig({ appRoot, environment: "test", env: {}, warn }).workerConcurrency).toBe(4);
      expect(warnings).toEqual(["config/fabricate.json is deprecated and stops being read in the next release. Rename it to config/frontend-registry.json."]);
    });

    it("reads only config/frontend-registry.json when both files exist", () => {
      writeConfig("frontend-registry.json", { workerConcurrency: 5 });
      writeConfig("fabricate.json", { workerConcurrency: 4 });

      expect(loadConfig({ appRoot, environment: "test", env: {}, warn }).workerConcurrency).toBe(5);
      expect(warnings).toEqual([]);
    });

    it("names the new file when neither exists", () => {
      expect(() => loadConfig({ appRoot, environment: "test", env: {}, warn })).toThrow(/Could not read .*config\/frontend-registry\.json/);
    });
  });

  describe("template demo switch", () => {
    it("is on in development and test, and off in production, by default", () => {
      const committed = (environment: "development" | "test" | "production") => loadConfig({ appRoot: process.cwd(), environment, env: {} }).demoEnabled;

      expect(committed("development")).toBe(true);
      expect(committed("test")).toBe(true);
      expect(committed("production")).toBe(false);
    });

    it.each([
      ["true", true],
      ["TRUE", true],
      ["1", true],
      ["false", false],
      ["0", false],
    ])("accepts FRONTEND_REGISTRY_DEMO=%s", (value, expected) => {
      expect(load({ shared }, { FRONTEND_REGISTRY_DEMO: value }).demoEnabled).toBe(expected);
      expect(load({ shared: { ...shared, demo: { enabled: true } } }, { FRONTEND_REGISTRY_DEMO: value }).demoEnabled).toBe(expected);
    });

    it("lets the override enable the demo in production", () => {
      const config = loadConfig({ appRoot: process.cwd(), environment: "production", env: { FRONTEND_REGISTRY_DEMO: "true" } });
      expect(config.demoEnabled).toBe(true);
    });

    it("ignores a blank override", () => {
      expect(load({ shared }, { FRONTEND_REGISTRY_DEMO: " " }).demoEnabled).toBe(false);
    });

    it.each([["yes"], ["on"], ["2"]])("rejects FRONTEND_REGISTRY_DEMO=%s", (value) => {
      expect(() => load({ shared }, { FRONTEND_REGISTRY_DEMO: value })).toThrow(/FRONTEND_REGISTRY_DEMO must be true, false, 1, or 0/);
    });

    it("rejects a missing, non-boolean, or extended demo setting", () => {
      const { demo: _omitted, ...missing } = shared;
      expect(() => load({ shared: missing })).toThrow(ConfigurationError);
      expect(() => load({ shared: { ...shared, demo: { enabled: "yes" } } })).toThrow(ConfigurationError);
      expect(() => load({ shared: { ...shared, demo: { enabled: true, extra: 1 } } })).toThrow(ConfigurationError);
    });

    it("survives overrides of other settings", () => {
      const enabled = load({ shared: { ...shared, demo: { enabled: true } } });
      expect(withOverrides(enabled, { workerConcurrency: 1 }).demoEnabled).toBe(true);
      expect(withOverrides(enabled, { demo: { enabled: false } }).demoEnabled).toBe(false);
    });
  });

  describe("repository previews", () => {
    const withPreviews = (previews: Partial<Settings["previews"]>) => ({ shared: { ...shared, previews: { ...shared.previews, ...previews } } });

    it("are off, enroll nothing, and configure no Node by default, in every committed environment", () => {
      for (const environment of ["development", "test", "production"] as const) {
        expect(loadConfig({ appRoot: process.cwd(), environment, env: {} }).previews).toEqual({
          enabled: false,
          browser: null,
          trustedSources: [],
          nodeVersions: {},
          storage: path.join(process.cwd(), "storage/previews"),
          concurrency: 1,
          timeoutMinutes: 15,
          maxOutputBytes: 200 * 1024 * 1024,
          maxStorageBytes: 5 * 1024 * 1024 * 1024,
          refCacheSeconds: 60,
        });
      }
    });

    it("enroll remotes by canonical identity, whatever form of the clone URL is listed", () => {
      const config = load(withPreviews({ trustedSources: ["https://Git.Example.com:443/acme/orders.git", "ssh://git@git.example.com/acme/orders/", "https://git.example.com/acme/orders"] }));
      expect(config.previews.trustedSources).toEqual(["https://git.example.com/acme/orders", "ssh://git.example.com/acme/orders"]);
    });

    it("key Node installs by version and resolve their directories from the app root", () => {
      const config = load(withPreviews({ nodeVersions: { "22.11.0": "/opt/node-22/bin", "v20.18.1": "runtimes/node-20/bin" } }));
      expect(config.previews.nodeVersions).toEqual({ "22.11.0": "/opt/node-22/bin", "20.18.1": path.join(appRoot, "runtimes/node-20/bin") });
    });

    it("capture screenshots with Playwright's Chromium unless a channel or a browser's absolute path is given", () => {
      expect(load().previews.browser).toBeNull();
      expect(load(withPreviews({ browser: "msedge" })).previews.browser).toBe("msedge");
      expect(load(withPreviews({ browser: "/usr/bin/chromium" })).previews.browser).toBe("/usr/bin/chromium");
    });

    it("keep preview storage under the app root unless an absolute directory is given", () => {
      expect(load().previews.storage).toBe(path.join(appRoot, "storage/previews"));
      expect(load(withPreviews({ storage: "/srv/previews" })).previews.storage).toBe("/srv/previews");
    });

    it("apply typed environment overrides", () => {
      const config = load({ shared }, {
        FRONTEND_REGISTRY_PREVIEWS: "true",
        FRONTEND_REGISTRY_PREVIEWS_BROWSER: "chrome",
        FRONTEND_REGISTRY_PREVIEWS_TRUSTED_SOURCES: "https://git.example.com/acme/orders.git \n ssh://git@git.example.com/acme/admin.git",
        FRONTEND_REGISTRY_PREVIEWS_NODE_VERSIONS: ["22.11.0=/opt/node-22/bin", "20.18.1=/opt/node-20/bin"].join(path.delimiter),
        FRONTEND_REGISTRY_PREVIEWS_STORAGE: "/var/lib/frontend-registry/previews",
        FRONTEND_REGISTRY_PREVIEWS_CONCURRENCY: "2",
        FRONTEND_REGISTRY_PREVIEWS_TIMEOUT_MINUTES: "30",
        FRONTEND_REGISTRY_PREVIEWS_MAX_OUTPUT_BYTES: "1000",
        FRONTEND_REGISTRY_PREVIEWS_MAX_STORAGE_BYTES: "5000",
        FRONTEND_REGISTRY_PREVIEWS_REF_CACHE_SECONDS: "0",
      });

      expect(config.previews).toEqual({
        enabled: true,
        browser: "chrome",
        trustedSources: ["https://git.example.com/acme/orders", "ssh://git.example.com/acme/admin"],
        nodeVersions: { "22.11.0": "/opt/node-22/bin", "20.18.1": "/opt/node-20/bin" },
        storage: "/var/lib/frontend-registry/previews",
        concurrency: 2,
        timeoutMinutes: 30,
        maxOutputBytes: 1000,
        maxStorageBytes: 5000,
        refCacheSeconds: 0,
      });
      expect(load({ shared }, { FRONTEND_REGISTRY_PREVIEWS: "0" }).previews.enabled).toBe(false);
      expect(load({ shared }, { FRONTEND_REGISTRY_PREVIEWS: " " }).previews.enabled).toBe(false);
    });

    it.each([
      ["a non-boolean switch", { FRONTEND_REGISTRY_PREVIEWS: "yes" }, /FRONTEND_REGISTRY_PREVIEWS must be true, false, 1, or 0/],
      ["zero concurrency", { FRONTEND_REGISTRY_PREVIEWS_CONCURRENCY: "0" }, ConfigurationError],
      ["a fractional time limit", { FRONTEND_REGISTRY_PREVIEWS_TIMEOUT_MINUTES: "1.5" }, /must be a positive integer/],
      ["a negative output limit", { FRONTEND_REGISTRY_PREVIEWS_MAX_OUTPUT_BYTES: "-1" }, /must be a positive integer/],
      ["a Node entry without a directory", { FRONTEND_REGISTRY_PREVIEWS_NODE_VERSIONS: "22.11.0" }, /must be version=directory/],
      ["a trusted source with credentials", { FRONTEND_REGISTRY_PREVIEWS_TRUSTED_SOURCES: "https://user:secret@git.example.com/acme/orders.git" }, /not a valid clone URL/],
    ])("reject %s from the environment", (_label, env, error) => {
      expect(() => load({ shared }, env)).toThrow(error);
    });

    it.each([
      ["a Node version that isn't a full version", { nodeVersions: { "22": "/opt/node-22/bin" } }, /must be a full version/],
      ["one Node version configured twice", { nodeVersions: { "22.11.0": "/a", "v22.11.0": "/b" } }, /configured twice/],
      ["a blank Node directory", { nodeVersions: { "22.11.0": " " } }, ConfigurationError],
      ["a blank storage directory", { storage: " " }, ConfigurationError],
      ["a scp-style trusted source", { trustedSources: ["git@git.example.com:acme/orders.git"] }, /not a valid clone URL/],
      ["a blank trusted source", { trustedSources: [" "] }, ConfigurationError],
      ["a zero storage limit", { maxStorageBytes: 0 }, ConfigurationError],
      ["a relative browser path", { browser: "bin/chrome" }, /a Playwright channel, such as chrome, or an absolute path/],
      ["a blank browser", { browser: " " }, ConfigurationError],
    ])("reject %s in the file", (_label, previews, error) => {
      expect(() => load(withPreviews(previews as Partial<Settings["previews"]>))).toThrow(error);
    });

    it("reject a missing or extended previews section, and survive overrides of other settings", () => {
      const { previews: _omitted, ...missing } = shared;
      expect(() => load({ shared: missing })).toThrow(ConfigurationError);
      expect(() => load(withPreviews({ extra: true } as Partial<Settings["previews"]>))).toThrow(ConfigurationError);

      const enabled = load(withPreviews({ enabled: true, trustedSources: ["https://git.example.com/acme/orders.git"] }));
      expect(withOverrides(enabled, { workerConcurrency: 1 }).previews).toMatchObject({ enabled: true, trustedSources: ["https://git.example.com/acme/orders"] });
      expect(withOverrides(enabled, { previews: { enabled: false } }).previews).toMatchObject({ enabled: false, trustedSources: ["https://git.example.com/acme/orders"] });
    });
  });
});

describe("npm run config", () => {
  it("prints the preview settings", async () => {
    const { execFileSync } = await import("node:child_process");
    const output = execFileSync("npx", ["tsx", "src/lib/config/print-cli.ts"], {
      encoding: "utf8",
      env: { ...process.env, FRONTEND_REGISTRY_ENV: "test", FRONTEND_REGISTRY_PREVIEWS: "true", FRONTEND_REGISTRY_PREVIEWS_TRUSTED_SOURCES: "https://git.example.com/acme/orders.git", FRONTEND_REGISTRY_PREVIEWS_NODE_VERSIONS: "22.11.0=/opt/node-22/bin" },
    });
    expect(output).toContain("Previews:           enabled");
    expect(output).toContain("Preview sources:    https://git.example.com/acme/orders");
    expect(output).toContain("Preview Node:       22.11.0=/opt/node-22/bin");
    expect(output).toMatch(/Preview storage: {4}\/.+\/storage\/previews\n/);
    expect(output).toContain("Preview limits:     concurrency=1, timeoutMinutes=15, maxOutputBytes=209715200, maxStorageBytes=5368709120, refCacheSeconds=60");
  }, 30_000);
});
