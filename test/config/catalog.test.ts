import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseRules } from "@repo-facts/catalog-builder";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CATALOG_FILE, RULES_DIRECTORY, catalogConfiguration, loadCatalog } from "@/lib/catalog/configuration";
import { ConfigurationError, type Settings, loadConfig, withOverrides } from "@/lib/config";
import { LEGACY_NAMES } from "@/lib/legacy-names";
import { saltRules } from "../support/catalog";

const SALT_YAML = `things:
  - kind: design_system
    id: salt
    package: "@salt-ds/core"
    tokens: "@salt-ds/theme"
    icons: "@salt-ds/icons"
    data: { package: "@salt-ds/mcp", format: salt-mcp }
`;

describe("the Reference Catalog's configuration", () => {
  let appRoot: string;

  beforeEach(() => {
    appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-registry-catalog-"));
    fs.mkdirSync(path.join(appRoot, RULES_DIRECTORY), { recursive: true });
  });
  afterEach(() => fs.rmSync(appRoot, { recursive: true, force: true }));

  const write = (catalog: string, rules: Record<string, string> = { salt: saltRules() }) => {
    fs.writeFileSync(path.join(appRoot, CATALOG_FILE), catalog);
    for (const [id, text] of Object.entries(rules)) fs.writeFileSync(path.join(appRoot, RULES_DIRECTORY, `${id}.yaml`), text);
  };

  it("reads each described thing with its packages, sources, and the version of its rules", () => {
    write(SALT_YAML);
    const [salt, ...others] = loadCatalog(appRoot).things;
    expect(others).toEqual([]);
    expect(salt).toMatchObject({ key: "design_system:salt", kind: "design_system", id: "salt", package: "@salt-ds/core", tokens: "@salt-ds/theme", icons: "@salt-ds/icons", data: { package: "@salt-ds/mcp", format: "salt-mcp" } });
    expect(salt!.rules).toEqual({ file: "config/catalog-rules/salt.yaml", text: saltRules(), version: parseRules(saltRules()).version });
  });

  it("loads the committed config/catalog.yaml, which describes Salt with the team's rules", () => {
    const committed = catalogConfiguration(loadConfig({ appRoot: process.cwd(), environment: "test", env: {} }));
    expect(committed.things.map((thing) => thing.key)).toEqual(["design_system:salt"]);
    expect(committed.things[0]!.rules.version).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("rejects an unknown key, in the file or in a thing", () => {
    write(`${SALT_YAML}schedule: daily\n`);
    expect(() => loadCatalog(appRoot)).toThrow(/Invalid config\/catalog\.yaml[\s\S]*schedule/);
    write(SALT_YAML.replace("    id: salt\n", "    id: salt\n    owner: de\n"));
    expect(() => loadCatalog(appRoot)).toThrow(/Invalid config\/catalog\.yaml[\s\S]*owner/);
  });

  it("rejects a thing described twice, without rules, or with another thing's rules", () => {
    write(`${SALT_YAML}${SALT_YAML.replace("things:\n", "")}`);
    expect(() => loadCatalog(appRoot)).toThrow(/describes design_system:salt more than once/);
    write(SALT_YAML.replace("id: salt", "id: mosaic"), {});
    expect(() => loadCatalog(appRoot)).toThrow(/config\/catalog-rules\/mosaic\.yaml can't be read/);
    write(SALT_YAML.replace("id: salt", "id: mosaic"), { mosaic: saltRules() });
    expect(() => loadCatalog(appRoot)).toThrow(/describes salt, not mosaic/);
    write(SALT_YAML.replace('"@salt-ds/icons"', '"@salt-ds/glyphs"'));
    expect(() => loadCatalog(appRoot)).toThrow(/doesn't list @salt-ds\/glyphs among salt's packages/);
    write(SALT_YAML, { salt: "format: 1\nid: salt\n" });
    expect(() => loadCatalog(appRoot)).toThrow(ConfigurationError);
  });

  describe("the registry Catalog builds read from", () => {
    const shared = (registry?: string): Settings => {
      const committed = loadConfig({ appRoot: process.cwd(), environment: "test", env: {} }).settings;
      return { ...committed, catalog: registry === undefined ? committed.catalog : { registry } };
    };

    it("defaults to the public npm registry in every committed environment", () => {
      for (const environment of ["development", "test", "production"] as const) {
        expect(loadConfig({ appRoot: process.cwd(), environment, env: {} }).catalog).toEqual({ registry: "https://registry.npmjs.org/" });
      }
    });

    it("is set by FRONTEND_REGISTRY_CATALOG_REGISTRY, and always ends in a slash", () => {
      const config = loadConfig({ appRoot, environment: "test", env: { FRONTEND_REGISTRY_CATALOG_REGISTRY: "https://npm.internal.example/repository/npm" }, file: { shared: shared() } });
      expect(config.catalog.registry).toBe("https://npm.internal.example/repository/npm/");
      expect(withOverrides(config, { gitTimeoutSeconds: 5 }).catalog).toEqual(config.catalog);
    });

    it("has no name from before the rename to fall back to", () => {
      const warnings: string[] = [];
      const config = loadConfig({ appRoot, environment: "test", env: { [`${LEGACY_NAMES.envPrefix}CATALOG_REGISTRY`]: "https://old.example/" }, file: { shared: shared() }, warn: (message) => warnings.push(message) });
      expect(config.catalog.registry).toBe("https://registry.npmjs.org/");
      expect(warnings).toEqual([]);
    });

    it("rejects an address that isn't http or https, and a missing or extended section", () => {
      expect(() => loadConfig({ appRoot, environment: "test", env: {}, file: { shared: shared("ftp://npm.example/") } })).toThrow(/http or https/);
      expect(() => loadConfig({ appRoot, environment: "test", env: { FRONTEND_REGISTRY_CATALOG_REGISTRY: "not a url" }, file: { shared: shared() } })).toThrow(ConfigurationError);
      const { catalog: _omitted, ...missing } = shared();
      expect(() => loadConfig({ appRoot, environment: "test", env: {}, file: { shared: missing } })).toThrow(ConfigurationError);
      expect(() => loadConfig({ appRoot, environment: "test", env: {}, file: { shared: { ...shared(), catalog: { registry: "https://registry.npmjs.org/", token: "x" } } } })).toThrow(ConfigurationError);
    });
  });
});
