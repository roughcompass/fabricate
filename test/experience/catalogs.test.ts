import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODULES_FILE, THEMES_FILE, TOOLKITS_FILE, capabilityToolkits, designThemes, readCatalog, runtimeModules } from "@/lib/experience/catalogs";
import { compareVersions, isRange, resolveRange } from "@/lib/experience/semver";
import { z } from "zod";

/*
 * The experience editor's catalogs (add-portal-experience-editor task 1.1):
 * the committed files load, an invalid entry is left out and logged, and
 * ranges resolve to the highest published version they match.
 */

describe("the committed catalogs", () => {
  it("load five themes with Default first and default, five toolkits, and twenty modules", () => {
    expect(designThemes().map((theme) => theme.id)).toEqual(["default", "payments", "digital-bank", "markets", "chase"]);
    expect(designThemes().filter((theme) => theme.default).map((theme) => theme.id)).toEqual(["default"]);
    expect(capabilityToolkits().map((toolkit) => [toolkit.id, toolkit.installed])).toEqual([
      ["global-search", false],
      ["notifications", false],
      ["system-messages", true],
      ["menu-management", true],
      ["session-management", true],
    ]);
    expect(runtimeModules()).toHaveLength(20);
    // Every toolkit's module is in the registry.
    for (const toolkit of capabilityToolkits()) expect(runtimeModules().some((module) => module.name === toolkit.module), toolkit.module).toBe(true);
    for (const file of [THEMES_FILE, TOOLKITS_FILE, MODULES_FILE]) expect(fs.existsSync(file)).toBe(true);
  });

  it("leaves out an invalid or repeated entry, keeping the rest, and reports an unreadable file", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "catalog-")), "modules.yaml");
    fs.writeFileSync(file, "modules:\n  - { name: '@a/b', versions: ['1.0.0'] }\n  - { name: 'nope', versions: ['1.0.0'] }\n  - { name: '@a/b', versions: ['2.0.0'] }\n");
    const result = readCatalog(file, "modules", z.strictObject({ name: z.string().startsWith("@"), versions: z.array(z.string()) }), (entry) => entry.name);
    expect(result.ok && result.entries.map((entry) => entry.name)).toEqual(["@a/b"]);
    expect(result.ok && result.skipped).toHaveLength(2);
    expect(readCatalog(path.join(os.tmpdir(), "missing.yaml"), "modules", z.unknown(), String)).toMatchObject({ ok: false });
  });
});

describe("version ranges", () => {
  const versions = ["2.4.1", "2.3.0", "1.9.9", "3.0.0-beta.1", "2.5.0-rc.1"];

  it("resolves to the highest matching release", () => {
    expect(resolveRange(versions, "^2.0.0")).toBe("2.4.1");
    expect(resolveRange(versions, "~2.3.0")).toBe("2.3.0");
    expect(resolveRange(versions, "2.x")).toBe("2.4.1");
    expect(resolveRange(versions, ">=1.0.0")).toBe("2.4.1");
    expect(resolveRange(versions, "<2.0.0")).toBe("1.9.9");
    expect(resolveRange(versions, "*")).toBe("2.4.1");
    expect(resolveRange(versions, "1.9.9")).toBe("1.9.9");
  });

  it("matches a prerelease only when named, and nothing for an unmatched or invalid range", () => {
    expect(resolveRange(versions, "3.0.0-beta.1")).toBe("3.0.0-beta.1");
    expect(resolveRange(versions, "^4.0.0")).toBeNull();
    expect(resolveRange(versions, "banana")).toBeNull();
    expect(isRange("^2.0.0")).toBe(true);
    expect(isRange("two")).toBe(false);
  });

  it("orders prereleases before their release", () => {
    expect(compareVersions("2.5.0-rc.1", "2.5.0")).toBeLessThan(0);
    expect(["1.0.0", "1.10.0", "1.2.0"].sort(compareVersions)).toEqual(["1.0.0", "1.2.0", "1.10.0"]);
  });
});
