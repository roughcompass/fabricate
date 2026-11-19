import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { type CatalogThing, type PackageFiles, buildEntry, readPackage, readTarball } from "@repo-facts/catalog-builder";
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

/** A gzipped npm tarball holding +files+ under `package/`, with a package.json naming +name+ at +version+. */
export function packageTarball(name: string, version: string, files: Readonly<Record<string, string | Uint8Array>> = {}, manifest: Record<string, unknown> = {}): Buffer {
  const entries: [string, Buffer][] = [["package/package.json", Buffer.from(JSON.stringify({ name, version, ...manifest }))], ...Object.entries(files).map(([file, content]): [string, Buffer] => [`package/${file}`, Buffer.from(content)])];
  const blocks: Buffer[] = [];
  for (const [file, content] of entries) {
    const header = Buffer.alloc(512);
    header.write(file, 0, 100, "utf8");
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.write("        ", 148);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

/** A package version a fake registry serves. */
export interface Published {
  name: string;
  version: string;
  tarball: Buffer;
  /** When it was published; versions without one are published in the order listed. */
  time?: string;
  dependencies?: Record<string, string>;
}

/** Salt 1.75.0's packages, as the public registry serves them, from the fixtures. */
export function saltPackages(): Published[] {
  return [
    { name: "@salt-ds/theme", version: "1.48.0", tarball: fixtureTarball("@salt-ds/theme", "1.48.0"), time: "2026-01-10T00:00:00.000Z" },
    { name: "@salt-ds/icons", version: "1.19.0", tarball: fixtureTarball("@salt-ds/icons", "1.19.0"), time: "2026-01-10T00:00:00.000Z" },
    { name: "@salt-ds/core", version: "1.75.0", tarball: fixtureTarball("@salt-ds/core", "1.75.0"), time: "2026-01-20T00:00:00.000Z", dependencies: { "@salt-ds/icons": "^1.19.0" } },
    { name: "@salt-ds/mcp", version: SALT_MCP_VERSION, tarball: fixtureTarball("@salt-ds/mcp", SALT_MCP_VERSION), time: "2026-03-31T14:16:37.000Z" },
  ];
}

/** The other components the team's Salt rules name, as providers and equivalents. */
const RULED_COMPONENTS = ["Dialog", "Dropdown", "H1", "H2", "H3", "H4", "Input", "Label", "Link", "MultilineInput", "SaltProvider", "SaltProviderNext", "Text"];

/** A small `@salt-ds/core` at +version+, published at +time+, declaring Button and the components the team's rules name. */
export function saltCore(version: string, time: string): Published {
  const declarations = [
    'export interface ButtonProps { appearance?: "solid" | "bordered" | "transparent"; disabled?: boolean; }',
    "export declare function Button(props: ButtonProps): JSX.Element;",
    ...RULED_COMPONENTS.map((name) => `export declare function ${name}(props: { children?: unknown }): JSX.Element;`),
  ].join("\n");
  return { name: "@salt-ds/core", version, time, tarball: packageTarball("@salt-ds/core", version, { "dist-types/index.d.ts": declarations }, { types: "dist-types/index.d.ts" }), dependencies: { "@salt-ds/icons": "^1.19.0" } };
}

/** +published+'s files republished at +version+, at +time+, as a later snapshot of the same data. */
export function republished(published: Published, version: string, time: string): Published {
  const files = readTarball(published.tarball);
  const manifest = JSON.parse(Buffer.from(files.get("package.json")!).toString("utf8")) as Record<string, unknown>;
  files.delete("package.json");
  return { ...published, version, time, tarball: packageTarball(published.name, version, Object.fromEntries(files), { ...manifest, name: published.name, version }) };
}

export interface FakeRegistry {
  readonly registry: string;
  readonly fetch: typeof fetch;
  /** Every address fetched, in order. */
  readonly requests: string[];
}

/** A registry at +registry+ serving +packages+' metadata and tarballs, as npm does. Anything else is 404. */
export function fakeRegistry(packages: readonly Published[], registry = "https://registry.test/"): FakeRegistry {
  const requests: string[] = [];
  const byName = Map.groupBy(packages, (item) => item.name);
  const tarballs = new Map(packages.map((item) => [`${registry}${item.name}/-/${item.name.split("/").pop()}-${item.version}.tgz`, item.tarball]));
  const fake = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push(url);
    const tarball = tarballs.get(url);
    if (tarball) return new Response(new Uint8Array(tarball), { status: 200 });
    const versions = byName.get(decodeURIComponent(url.slice(registry.length)));
    if (!url.startsWith(registry) || !versions) return new Response("not found", { status: 404 });
    const name = versions[0]!.name;
    const latest = versions.at(-1)!.version;
    const time = Object.fromEntries(versions.map((item, index) => [item.version, item.time ?? new Date(Date.UTC(2026, 0, 1 + index)).toISOString()]));
    const integrity = (bytes: Buffer) => `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`;
    const body = {
      name,
      "dist-tags": { latest },
      time,
      versions: Object.fromEntries(versions.map((item) => [item.version, { name, version: item.version, dependencies: item.dependencies ?? {}, dist: { tarball: `${registry}${name}/-/${name.split("/").pop()}-${item.version}.tgz`, integrity: integrity(item.tarball) } }])),
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { registry, fetch: fake, requests };
}

/** A fetch that can't reach any registry. */
export const unreachable = (async (input: string | URL | Request) => {
  throw new TypeError(`fetch failed: connect ECONNREFUSED ${String(input instanceof Request ? input.url : input)}`);
}) as typeof fetch;
