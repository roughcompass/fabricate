import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIFECYCLE_STATES, REVISION_STATES } from "@/lib/db/schema";
import { compositionOutline } from "@/lib/onboarding/applications";
import { ALLOWED_OPERATIONS } from "@/lib/onboarding/external/contracts";
import { canonicalDocument } from "@/lib/onboarding/formats";
import { normalizeRoute } from "@/lib/onboarding/routes";
import { createTestDb } from "../support/db";
import { buildSource } from "../support/builders";
import { CHILD_RENDERING, onboardApplication, registerMfe } from "../support/onboarding";

// docs/onboarding.md names the states the schema defines, and the database
// objects that enforce each cardinality it documents.
const doc = fs.readFileSync(path.resolve("docs/onboarding.md"), "utf8");

/** The rows of the table under +heading+, as cells. */
function table(heading: string): string[][] {
  const start = doc.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  const lines = doc.slice(start).split("\n").slice(1);
  const rows: string[][] = [];
  for (const line of lines.slice(lines.findIndex((candidate) => candidate.startsWith("|")))) {
    if (!line.startsWith("|")) break;
    rows.push(line.split("|").slice(1, -1).map((cell) => cell.trim()));
  }
  return rows.slice(2);
}

const ticked = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);

/** The text from +heading+ to the next heading of the same level. */
function section(heading: string): string {
  const start = doc.indexOf(`\n${heading}\n`);
  expect(start, heading).toBeGreaterThan(-1);
  const level = heading.split(" ")[0]!;
  const rest = doc.slice(start + heading.length + 2);
  const end = rest.search(new RegExp(`\n${level} `));
  return end === -1 ? rest : rest.slice(0, end);
}

describe("onboarding documentation", () => {
  it("documents exactly the lifecycle and revision states the schema defines", () => {
    expect(table("### Lifecycle").map((row) => ticked(row[0]!)[0])).toEqual([...LIFECYCLE_STATES]);
    expect(table("## Revisions").map((row) => ticked(row[0]!)[0])).toEqual([...REVISION_STATES]);
  });

  it("names a database object that exists for every cardinality it documents", () => {
    const db = createTestDb();
    const objects = new Set((db.$client.prepare("select name from sqlite_master where name is not null").all() as { name: string }[]).map((row) => row.name));
    // Constraint names live in table definitions, not sqlite_master.
    const definitions = (db.$client.prepare("select sql from sqlite_master where type = 'table' and sql is not null").all() as { sql: string }[]).map((row) => row.sql).join("\n");
    const rows = table("## Cardinalities");
    expect(rows.length).toBeGreaterThan(12);
    const named = rows.flatMap((row) => ticked(row[2]!));
    expect(named.filter((name) => !objects.has(name) && !definitions.includes(`"${name}"`))).toEqual([]);
  });

  it("shows document fixtures that parse under the format each declares", () => {
    const fixtures = [...doc.matchAll(/```json (portal|application|microfrontend)-v(\d)\n([\s\S]*?)```/g)].map((match) => ({ kind: match[1] as "portal" | "application" | "microfrontend", version: Number(match[2]) as 1 | 2, document: JSON.parse(match[3]!) as unknown }));
    expect(fixtures.map((fixture) => `${fixture.kind}-v${fixture.version}`)).toEqual(["portal-v2", "microfrontend-v2", "application-v2"]);
    for (const fixture of fixtures) expect(() => canonicalDocument(fixture.kind, fixture.version, fixture.document), `${fixture.kind}-v${fixture.version}`).not.toThrow();
    // Nothing a v2 document holds asks for platform policy.
    expect(JSON.stringify(fixtures.map((fixture) => fixture.document))).not.toMatch(/"(runtimes|contract|requires|provides|capabilities|requiredCapabilities|events|context|shared|hostContract|hostConfiguration|inheritFrom)"/);
  });

  it("names a unit test for every environment catalog state it documents", () => {
    const tests = fs.readFileSync(path.resolve("test/onboarding/environments.test.ts"), "utf8");
    const rows = table("## Environment catalog");
    expect(rows.length).toBeGreaterThan(6);
    expect(new Set(rows.map((row) => row[1]!.replace(/, .*/, "")))).toEqual(new Set(["Fallback", "Studio"]));
    for (const row of rows) for (const name of ticked(row[3]!)) expect(tests, name).toContain(`it("${name}`);
  });

  it("describes Portals by identity, environments, menus, defaults, and placement review only", () => {
    const portals = section("## Portals");
    expect(portals).toContain("owning team");
    expect(portals).toContain("environment catalog");
    expect(portals).not.toMatch(/runtime|contract|inherit|entitlement|capabilit|allowed origin|sandbox/i);
  });

  it("shows Application and MFE examples with no capability, event, context, shared-dependency, or host-policy questionnaire", () => {
    for (const heading of ["## Web Applications", "## MFE assets"]) {
      const text = section(heading);
      expect(text, heading).not.toMatch(/required capabilit|host contract|host configuration|requires|provides/i);
      for (const block of [...text.matchAll(/```[a-z0-9-]*\n([\s\S]*?)```/g)].map((match) => match[1]!)) expect(block, heading).not.toMatch(/capabilit|event|context|shared|host/i);
    }
  });

  it("names the source and observation time of every comparison reconciliation makes", () => {
    const rows = table("### Comparisons");
    expect(rows.length).toBeGreaterThan(5);
    const operations = new Set<string>(Object.values(ALLOWED_OPERATIONS).map((operation) => operation.operationId));
    for (const row of rows) {
      expect(row[2], row[0]).toMatch(/^(Studio|CDaaS) /);
      expect(ticked(row[2]!).filter((operation) => operations.has(operation)), row[0]).toHaveLength(1);
      expect(row[3], row[0]).toMatch(/^The read that last observed /);
    }
  });

  it("normalizes each documented route as documented", () => {
    for (const [entered, outcome] of table("### Menus and routes").map((row) => [ticked(row[0]!)[0]!, row[1]!] as const)) {
      const normalized = normalizeRoute(entered);
      if (outcome.startsWith("Refused")) expect(normalized.route, entered).toBeNull();
      else expect(normalized.route, entered).toBe(ticked(outcome)[0]);
    }
  });

  it("uses CDaaS terms the vendored CDaaS contract defines", () => {
    const contract = fs.readFileSync(path.resolve("../openspec/api-specs/cdaas-admin.openapi.json"), "utf8");
    const rows = table("### The CDaaS view and its versions");
    const terms = rows.flatMap((row) => ticked(row[1]!));
    expect(terms.length).toBeGreaterThan(10);
    expect(terms.filter((term) => !contract.includes(`"${term}"`))).toEqual([]);
  });

  it("draws each composition outline from its fixture", () => {
    const db = createTestDb();
    const host = registerMfe(db, "Payee hub", { repository: buildSource(db, { name: "hub" }) });
    const children = ["Search", "Details", "History"].map((name) => registerMfe(db, `Payee ${name}`, { repository: buildSource(db, { name: `payee-${name.toLowerCase()}` }), rendering: CHILD_RENDERING }));
    const managed = onboardApplication(db, "Payee hub", {
      launch: { kind: "mfe", microfrontend: host.publicId, mode: "module_federation_2", exposedModule: "./App" },
      children: children.map((child, index) => ({ microfrontend: child.publicId, mountKind: "slot" as const, mountKey: ["search", "details", "history"][index]!, required: index < 2, module: null })),
    }).application;
    const external = onboardApplication(db, "Payments console", {
      launch: { kind: "external", mode: "esm", moduleUrl: "https://cdn.example.com/console.js", exportedModule: "mount" },
      children: [children[0]!, children[1]!].map((child) => ({ microfrontend: child.publicId, mountKind: "route" as const, mountKey: `/${child.name.split(" ")[1]!.toLowerCase()}`, required: true, module: null })),
    }).application;
    const start = doc.indexOf("### Composition");
    const blocks = [...doc.slice(start).matchAll(/```text\n([\s\S]*?)\n```/g)].map((match) => match[1]);
    expect(blocks.slice(0, 2)).toEqual([compositionOutline(db, managed.activeRevisionId!), compositionOutline(db, external.activeRevisionId!)]);
  });

  it("names a review test for every transition, and says approval changes nothing outside Fabricate", () => {
    const tests = fs.readFileSync(path.resolve("test/onboarding/reviews/reviews.test.ts"), "utf8");
    const rows = table("### States");
    expect(rows.map((row) => row[0]).filter((from) => from!.includes("`pending`")).length).toBe(3);
    for (const row of rows) for (const name of ticked(row[3]!)) expect(tests, name).toContain(`it("${name}`);
    expect(doc).toContain("Approving a placement changes nothing in Studio, CDaaS, or ServiceNow.");
  });

  it("documents exactly the allowed requests, each one recorded by a recording-server test", () => {
    const tests = fs.readFileSync(path.resolve("test/onboarding/external/clients.test.ts"), "utf8");
    const rows = table("### Requests");
    const documented = rows.map((row) => `${row[1]} ${ticked(row[2]!)[0]}`).sort();
    expect(documented).toEqual(Object.values(ALLOWED_OPERATIONS).map((operation) => `${operation.method} ${operation.path}`).sort());
    for (const row of rows) {
      const pattern = new RegExp(`\\["GET", "[^"]*${ticked(row[2]!)[0]!.replace(/\{\w+\}/g, "[^/\"]+").replace(/\//g, "\\/")}"`);
      expect(tests, row[2]).toMatch(pattern);
    }
  });
});
