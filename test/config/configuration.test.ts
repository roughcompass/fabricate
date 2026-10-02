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
  analysis: { maxBlobBytes: 1024, maxFiles: 10, maxTotalBytes: 4096 },
  demo: { enabled: false },
  deConsole: { source: null, refreshMinutes: 60 },
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
    expect(config.analysis).toEqual({ maxBlobBytes: 1024, maxFiles: 10, maxTotalBytes: 4096 });
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
});
