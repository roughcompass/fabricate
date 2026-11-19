import fs from "node:fs";
import path from "node:path";
import { type CatalogThing, type PackageFiles, buildEntry, readPackage } from "@repo-facts/catalog-builder";
import type { DesignSystemEntry } from "@repo-facts/contract";

/*
 * Reference Catalog entries for tests. test/fixtures/catalog holds Salt's
 * published tarballs as Surveyor's Catalog Builder tests keep them: npm
 * tarballs trimmed to what the builder reads (type declarations,
 * stylesheets, and the published data's fields). Building from them needs no
 * network, so tests survey against the entry a real build writes.
 */

export const CATALOG_FIXTURES = path.resolve("test/fixtures/catalog");

/** When fixture entries are recorded as built. */
export const FIXTURE_BUILT_AT = "2026-11-19T00:00:00.000Z";

/** Salt, as config/catalog.yaml describes it. */
export const SALT: CatalogThing = { kind: "design_system", id: "salt", package: "@salt-ds/core", tokens: "@salt-ds/theme", icons: "@salt-ds/icons", data: { package: "@salt-ds/mcp", format: "salt-mcp" } };

export const SALT_MCP_VERSION = "0.0.0-snapshot-20260331141637";

/** The team's rules for Salt, as the Frontend Registry builds with them. */
export const saltRules = (): string => fs.readFileSync(path.resolve("config/catalog-rules/salt.yaml"), "utf8");

/** A fixture tarball's bytes, such as `@salt-ds/core` 1.75.0. */
export function fixtureTarball(name: string, version: string): Buffer {
  return fs.readFileSync(path.join(CATALOG_FIXTURES, `${name.replace("@", "").replace("/", "-")}-${version}.tgz`));
}

const read = (name: string, version: string): PackageFiles => readPackage(name, version, fixtureTarball(name, version));

let salt: DesignSystemEntry | undefined;

/** The Salt 1.75.0 entry the Catalog Builder writes from the fixtures and the team's rules. */
export function saltEntry(): DesignSystemEntry {
  salt ??= buildEntry(
    SALT,
    { packages: new Map([read("@salt-ds/core", "1.75.0"), read("@salt-ds/theme", "1.48.0"), read("@salt-ds/icons", "1.19.0")].map((pkg) => [pkg.name, pkg])), data: read("@salt-ds/mcp", SALT_MCP_VERSION), rules: saltRules() },
    { builtAt: FIXTURE_BUILT_AT },
  );
  return salt;
}
