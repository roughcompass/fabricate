import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REGISTRY_DIR, registryRelease } from "@/lib/prototypes/salt/adapter";

// design.md, decision 6: the committed registry describes the Salt release DE
// FabLab renders with. Upgrading Salt means bumping the packages and running
// `node scripts/build-salt-registry.mjs`; this test blocks a build where the two differ.
describe("committed Salt registry", () => {
  const installed = (name: string) => JSON.parse(fs.readFileSync(path.join("node_modules", name, "package.json"), "utf8")).version as string;
  const components = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, "components.json"), "utf8")).components as { name: string; package: { name: string } }[];

  it("lists the installed version of every Salt package it describes", () => {
    const { release, packages } = registryRelease();
    expect(release).toBe(installed("@salt-ds/core"));
    const described = Object.keys(packages).filter((name) => fs.existsSync(path.join("node_modules", name, "package.json")));
    expect(described).toEqual(expect.arrayContaining(["@salt-ds/core", "@salt-ds/lab", "@salt-ds/theme", "@salt-ds/icons", "@salt-ds/countries", "@salt-ds/date-components", "@salt-ds/date-adapters", "@salt-ds/ag-grid-theme"]));
    for (const name of described) expect(packages[name], name).toBe(installed(name));
  });

  it("places Tabs in core and Date picker in date-components, as the release does", () => {
    expect(components.find((component) => component.name === "Tabs")?.package.name).toBe("@salt-ds/core");
    expect(components.find((component) => component.name === "Date picker")?.package.name).toBe("@salt-ds/date-components");
  });

  it("names no local paths, so rebuilding it produces the same files", () => {
    const metadata = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, "metadata.json"), "utf8"));
    expect(metadata.build_info.source_root).toBe(`jpmorganchase/salt-ds@@salt-ds/core@${installed("@salt-ds/core")}`);
    for (const file of fs.readdirSync(REGISTRY_DIR)) expect(fs.readFileSync(path.join(REGISTRY_DIR, file), "utf8"), file).not.toContain(process.cwd());
  });
});
