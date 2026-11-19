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
  database: "storage/fabricate.sqlite3",
  repositoryStorage: "storage/repositories",
  gitCredentialHelper: null,
  analysis: { maxBlobBytes: 1024, maxLockfileBytes: 2048, maxFiles: 10, maxTotalBytes: 4096 },
  demo: { enabled: false },
  deConsole: { source: null, refreshMinutes: 60 },
  profiling: { checkMinutes: 60 },
  previews: { enabled: false, trustedSources: [], nodeVersions: {}, storage: "storage/previews", concurrency: 1, timeoutMinutes: 15, maxOutputBytes: 209_715_200, maxStorageBytes: 5_368_709_120 },
};

describe("configuration", () => {
  let workspace: string;
  let appRoot: string;
  let fleetKit: string;

  beforeEach(() => {
    workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabricate-config-")));
    appRoot = path.join(workspace, "fabricate");
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
    expect(config.database).toBe(path.join(appRoot, "storage/fabricate.sqlite3"));
    expect(config.analysis).toEqual({ maxBlobBytes: 1024, maxLockfileBytes: 2048, maxFiles: 10, maxTotalBytes: 4096 });
  });

  it("always denies fleet-kit, even when no denied roots are configured", () => {
    expect(load().deniedRoots).toContain(fleetKit);
  });

  it("cannot drop fleet-kit through an environment variable or an override", () => {
    const fromEnv = load({ shared }, { FABRICATE_DENIED_ROOTS: path.join(workspace, "other") });
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
      FABRICATE_ALLOWED_ROOTS: [path.join(workspace, "fleet"), path.join(workspace, "more")].join(path.delimiter),
      FABRICATE_GIT_TIMEOUT: "30",
      FABRICATE_WORKER_CONCURRENCY: "8",
      FABRICATE_MAX_FILES: "99",
      FABRICATE_GIT_CREDENTIAL_HELPER: "osxkeychain",
    });

    expect(config.allowedRoots).toEqual([path.join(workspace, "fleet"), path.join(workspace, "more")]);
    expect(config.gitTimeoutSeconds).toBe(30);
    expect(config.workerConcurrency).toBe(8);
    expect(config.analysis.maxFiles).toBe(99);
    expect(config.gitCredentialHelper).toBe("osxkeychain");
  });

  it.each([
    ["a non-numeric integer", { FABRICATE_GIT_TIMEOUT: "soon" }],
    ["a negative integer", { FABRICATE_MAX_FILES: "-1" }],
    ["zero", { FABRICATE_WORKER_CONCURRENCY: "0" }],
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
    ])("accepts FABRICATE_DEMO=%s", (value, expected) => {
      expect(load({ shared }, { FABRICATE_DEMO: value }).demoEnabled).toBe(expected);
      expect(load({ shared: { ...shared, demo: { enabled: true } } }, { FABRICATE_DEMO: value }).demoEnabled).toBe(expected);
    });

    it("lets the override enable the demo in production", () => {
      const config = loadConfig({ appRoot: process.cwd(), environment: "production", env: { FABRICATE_DEMO: "true" } });
      expect(config.demoEnabled).toBe(true);
    });

    it("ignores a blank override", () => {
      expect(load({ shared }, { FABRICATE_DEMO: " " }).demoEnabled).toBe(false);
    });

    it.each([["yes"], ["on"], ["2"]])("rejects FABRICATE_DEMO=%s", (value) => {
      expect(() => load({ shared }, { FABRICATE_DEMO: value })).toThrow(/FABRICATE_DEMO must be true, false, 1, or 0/);
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

  describe("DE Console source", () => {
    const withSource = (source: string | null) => ({ shared: { ...shared, deConsole: { source, refreshMinutes: 60 } } });

    it("is off unless a source is configured", () => {
      expect(load().deConsole).toEqual({ source: null, refreshMinutes: 60 });
      expect(loadConfig({ appRoot: process.cwd(), environment: "production", env: {} }).deConsole.source).toBeNull();
    });

    it("resolves an export file from the app root, and reads an endpoint and schedule from the environment", () => {
      expect(load(withSource("exports/de-console.json")).deConsole.source).toEqual({ kind: "file", path: path.join(appRoot, "exports/de-console.json") });
      const fromEnv = load({ shared }, { FABRICATE_DE_CONSOLE_SOURCE: "https://de-console.example.test/ownership", FABRICATE_DE_CONSOLE_REFRESH_MINUTES: "15" });
      expect(fromEnv.deConsole).toEqual({ source: { kind: "url", url: "https://de-console.example.test/ownership" }, refreshMinutes: 15 });
    });

    it("accepts plain HTTP only to this machine", () => {
      expect(load(withSource("http://127.0.0.1:4100/export")).deConsole.source).toEqual({ kind: "url", url: "http://127.0.0.1:4100/export" });
      expect(() => load(withSource("http://de-console.example.test/export"))).toThrow(/https:\/\/ URL/);
      expect(() => load(withSource("ftp://de-console.example.test/export"))).toThrow(ConfigurationError);
    });

    it("refuses credentials in the URL, which belong in the token variable", () => {
      expect(() => load(withSource("https://fid:secret@de-console.example.test/export"))).toThrow(/FABRICATE_DE_CONSOLE_TOKEN/);
    });

    it("never reads an export from the protected fleet-kit tree", () => {
      expect(() => load(withSource("../fleet-kit/ownership.json"))).toThrow(/protected fleet-kit/);
      fs.symlinkSync(fleetKit, path.join(workspace, "exports"));
      expect(() => load(withSource("../exports/ownership.json"))).toThrow(/protected fleet-kit/);
    });

    it("keeps the token out of the configuration", () => {
      const config = load(withSource("https://de-console.example.test/export"), { FABRICATE_DE_CONSOLE_TOKEN: "service-token" });
      expect(JSON.stringify(config)).not.toContain("service-token");
    });
  });

  describe("repository previews", () => {
    const withPreviews = (previews: Partial<Settings["previews"]>) => ({ shared: { ...shared, previews: { ...shared.previews, ...previews } } });

    it("are off, enroll nothing, and configure no Node by default, in every committed environment", () => {
      for (const environment of ["development", "test", "production"] as const) {
        expect(loadConfig({ appRoot: process.cwd(), environment, env: {} }).previews).toEqual({
          enabled: false,
          trustedSources: [],
          nodeVersions: {},
          storage: path.join(process.cwd(), "storage/previews"),
          concurrency: 1,
          timeoutMinutes: 15,
          maxOutputBytes: 200 * 1024 * 1024,
          maxStorageBytes: 5 * 1024 * 1024 * 1024,
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

    it("keep preview storage under the app root unless an absolute directory is given", () => {
      expect(load().previews.storage).toBe(path.join(appRoot, "storage/previews"));
      expect(load(withPreviews({ storage: "/srv/previews" })).previews.storage).toBe("/srv/previews");
    });

    it("apply typed environment overrides", () => {
      const config = load({ shared }, {
        FABRICATE_PREVIEWS: "true",
        FABRICATE_PREVIEWS_TRUSTED_SOURCES: "https://git.example.com/acme/orders.git \n ssh://git@git.example.com/acme/admin.git",
        FABRICATE_PREVIEWS_NODE_VERSIONS: ["22.11.0=/opt/node-22/bin", "20.18.1=/opt/node-20/bin"].join(path.delimiter),
        FABRICATE_PREVIEWS_STORAGE: "/var/lib/fabricate/previews",
        FABRICATE_PREVIEWS_CONCURRENCY: "2",
        FABRICATE_PREVIEWS_TIMEOUT_MINUTES: "30",
        FABRICATE_PREVIEWS_MAX_OUTPUT_BYTES: "1000",
        FABRICATE_PREVIEWS_MAX_STORAGE_BYTES: "5000",
      });

      expect(config.previews).toEqual({
        enabled: true,
        trustedSources: ["https://git.example.com/acme/orders", "ssh://git.example.com/acme/admin"],
        nodeVersions: { "22.11.0": "/opt/node-22/bin", "20.18.1": "/opt/node-20/bin" },
        storage: "/var/lib/fabricate/previews",
        concurrency: 2,
        timeoutMinutes: 30,
        maxOutputBytes: 1000,
        maxStorageBytes: 5000,
      });
      expect(load({ shared }, { FABRICATE_PREVIEWS: "0" }).previews.enabled).toBe(false);
      expect(load({ shared }, { FABRICATE_PREVIEWS: " " }).previews.enabled).toBe(false);
    });

    it.each([
      ["a non-boolean switch", { FABRICATE_PREVIEWS: "yes" }, /FABRICATE_PREVIEWS must be true, false, 1, or 0/],
      ["zero concurrency", { FABRICATE_PREVIEWS_CONCURRENCY: "0" }, ConfigurationError],
      ["a fractional time limit", { FABRICATE_PREVIEWS_TIMEOUT_MINUTES: "1.5" }, /must be a positive integer/],
      ["a negative output limit", { FABRICATE_PREVIEWS_MAX_OUTPUT_BYTES: "-1" }, /must be a positive integer/],
      ["a Node entry without a directory", { FABRICATE_PREVIEWS_NODE_VERSIONS: "22.11.0" }, /must be version=directory/],
      ["a trusted source with credentials", { FABRICATE_PREVIEWS_TRUSTED_SOURCES: "https://user:secret@git.example.com/acme/orders.git" }, /not a valid clone URL/],
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
  it("reports whether each read token is set, never its value", async () => {
    const { execFileSync } = await import("node:child_process");
    const output = execFileSync("npx", ["tsx", "src/lib/config/print-cli.ts"], {
      encoding: "utf8",
      env: { ...process.env, FABRICATE_ENV: "test", FABRICATE_DE_CONSOLE_SOURCE: "https://de-console.example.test/export", FABRICATE_DE_CONSOLE_TOKEN: "console-secret-91" },
    });
    expect(output).toContain("DE Console:         https://de-console.example.test/export, every 60 minutes, token set");
    expect(output).not.toContain("console-secret-91");
  }, 30_000);

  it("prints the preview settings", async () => {
    const { execFileSync } = await import("node:child_process");
    const output = execFileSync("npx", ["tsx", "src/lib/config/print-cli.ts"], {
      encoding: "utf8",
      env: { ...process.env, FABRICATE_ENV: "test", FABRICATE_PREVIEWS: "true", FABRICATE_PREVIEWS_TRUSTED_SOURCES: "https://git.example.com/acme/orders.git", FABRICATE_PREVIEWS_NODE_VERSIONS: "22.11.0=/opt/node-22/bin" },
    });
    expect(output).toContain("Previews:           enabled");
    expect(output).toContain("Preview sources:    https://git.example.com/acme/orders");
    expect(output).toContain("Preview Node:       22.11.0=/opt/node-22/bin");
    expect(output).toMatch(/Preview storage: {4}\/.+\/storage\/previews\n/);
    expect(output).toContain("Preview limits:     concurrency=1, timeoutMinutes=15, maxOutputBytes=209715200, maxStorageBytes=5368709120");
  }, 30_000);
});
