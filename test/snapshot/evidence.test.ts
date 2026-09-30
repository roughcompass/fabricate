import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FabricateConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { type Evidence, EvidenceError, entryEvidence, evidenceId, lineEvidence, pointerEvidence, resolveEvidence } from "@/lib/snapshot/evidence";
import { openSnapshot } from "@/lib/snapshot/open";
import type { BlobContent, SnapshotReader } from "@/lib/snapshot/reader";
import { StructuredParseError, parseJson, parseYaml, pointerLines, pointerOf, valueAt } from "@/lib/snapshot/structured";
import { acquire, acquisitionConfig, registerLocalSource } from "../support/acquisition";
import { createTestDb } from "../support/db";
import { GitFixture, type Repo } from "../support/git-fixture";

const PACKAGE_JSON = `{
  "name": "orders-ui",
  "dependencies": {
    "react": "^18.3.1",
    "@acme/ui": "2.0.0"
  },
  "scripts": { "test": "vitest run" }
}
`;

const WORKFLOW = `name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`;

describe("evidence locators", () => {
  let fixture: GitFixture;
  let config: FabricateConfig;
  let db: Db;
  let work: Repo;

  beforeEach(() => {
    source = undefined;
    fixture = GitFixture.create("evidence");
    config = acquisitionConfig(fixture);
    db = createTestDb();
    work = fixture.repo("fleet/orders");
    work.write("package.json", PACKAGE_JSON).write(".github/workflows/ci.yml", WORKFLOW).write("src/app.ts", "import React from 'react';\nexport const App = () => null;\n");
  });

  afterEach(() => {
    fixture.cleanup();
    fs.rmSync(config.repositoryStorage, { recursive: true, force: true });
  });

  let source: ReturnType<typeof registerLocalSource> | undefined;
  /** Commits the work repository and opens a reader on a fresh snapshot of it. */
  const snapshotOfWork = async (): Promise<SnapshotReader> => {
    work.commit();
    source ??= registerLocalSource(db, config, "orders", work.path);
    const { target, snapshot } = await acquire(db, config, source);
    return openSnapshot(target, snapshot, { config });
  };
  const contentOf = async (reader: SnapshotReader, path: string): Promise<BlobContent> => {
    const result = await reader.read(path);
    if (!result.ok) throw new Error(result.skip.detail);
    return result.content;
  };

  it("records and resolves a line range to the committed lines", async () => {
    const reader = await snapshotOfWork();
    const source = { commit: reader.commitSha, detector: "architecture", rule: "react-import" };
    const evidence = lineEvidence(await contentOf(reader, "src/app.ts"), source, 1);

    expect(evidence).toMatchObject({ commit: reader.commitSha, path: "src/app.ts", detector: "architecture", rule: "react-import", location: { kind: "lines", start: 1, end: 1 } });
    expect(evidence.content_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await resolveEvidence(reader, evidence)).toMatchObject({ ok: true, excerpt: "import React from 'react';", lines: { start: 1, end: 1 } });
  });

  it("records and resolves a JSON pointer, with the line range it occupies", async () => {
    const reader = await snapshotOfWork();
    const evidence = pointerEvidence(await contentOf(reader, "package.json"), { commit: reader.commitSha, detector: "manifest", rule: "dependency" }, "json", pointerOf(["dependencies", "@acme/ui"]));

    expect(evidence.location).toEqual({ kind: "pointer", format: "json", pointer: "/dependencies/@acme~1ui" });
    expect(await resolveEvidence(reader, evidence)).toMatchObject({ ok: true, excerpt: '"2.0.0"', lines: { start: 5, end: 5 } });
  });

  it("records and resolves a YAML pointer into a CI workflow", async () => {
    const reader = await snapshotOfWork();
    const evidence = pointerEvidence(await contentOf(reader, ".github/workflows/ci.yml"), { commit: reader.commitSha, detector: "ci", rule: "run-step" }, "yaml", "/jobs/test/steps/1/run");

    expect(await resolveEvidence(reader, evidence)).toMatchObject({ ok: true, excerpt: '"npm test"', lines: { start: 8, end: 8 } });
  });

  it("records an entry's presence and mode without its bytes", async () => {
    const reader = await snapshotOfWork();
    const evidence = entryEvidence(reader.entry("package.json")!, { commit: reader.commitSha, detector: "inventory", rule: "manifest" });

    expect(evidence.location).toEqual({ kind: "entry" });
    expect(await resolveEvidence(reader, evidence)).toMatchObject({ ok: true, lines: null });
  });

  it("derives a stable id from everything the record asserts", async () => {
    const reader = await snapshotOfWork();
    const content = await contentOf(reader, "src/app.ts");
    const source = { commit: reader.commitSha, detector: "architecture", rule: "react-import" };

    expect(lineEvidence(content, source, 1).id).toBe(lineEvidence(content, source, 1).id);
    expect(lineEvidence(content, { ...source, rule: "other" }, 1).id).not.toBe(lineEvidence(content, source, 1).id);
    expect(lineEvidence(content, source, 1).id).toMatch(/^ev_[0-9a-f]{24}$/);
  });

  it("refuses to create evidence for lines or pointers that do not exist", async () => {
    const reader = await snapshotOfWork();
    const source = { commit: reader.commitSha, detector: "d", rule: "r" };

    const app = await contentOf(reader, "src/app.ts");
    const manifest = await contentOf(reader, "package.json");
    expect(() => lineEvidence(app, source, 3)).toThrow(EvidenceError);
    expect(() => lineEvidence(app, source, 2, 1)).toThrow(EvidenceError);
    expect(() => pointerEvidence(manifest, source, "json", "/dependencies/vue")).toThrow(EvidenceError);
  });

  describe("stale and mismatched evidence", () => {
    let original: SnapshotReader;
    let evidence: Evidence;

    beforeEach(async () => {
      original = await snapshotOfWork();
      evidence = lineEvidence(await contentOf(original, "src/app.ts"), { commit: original.commitSha, detector: "architecture", rule: "react-import" }, 1);
    });

    const reissue = (changes: Partial<Evidence>): Evidence => {
      const fields = { ...evidence, ...changes };
      return { ...fields, id: evidenceId(fields) };
    };

    it("refuses evidence from another commit", async () => {
      work.write("src/app.ts", "import { h } from 'preact';\nexport const App = () => null;\n");
      const later = await snapshotOfWork();

      expect(await resolveEvidence(later, evidence)).toMatchObject({ ok: false, reason: "commit_mismatch" });
      expect(await resolveEvidence(later, reissue({ commit: later.commitSha }))).toMatchObject({ ok: false, reason: "content_changed" });
    });

    it("refuses a record whose fields were altered", async () => {
      expect(await resolveEvidence(original, { ...evidence, rule: "forged" })).toMatchObject({ ok: false, reason: "id_mismatch" });
    });

    it("refuses a record whose excerpt no longer matches the cited lines", async () => {
      expect(await resolveEvidence(original, reissue({ location: { kind: "lines", start: 2, end: 2 } }))).toMatchObject({ ok: false, reason: "excerpt_changed" });
      expect(await resolveEvidence(original, reissue({ location: { kind: "lines", start: 1, end: 9 } }))).toMatchObject({ ok: false, reason: "location_invalid" });
    });

    it("refuses a record for a path or content digest that is not in the snapshot", async () => {
      expect(await resolveEvidence(original, reissue({ path: "src/missing.ts" }))).toMatchObject({ ok: false, reason: "path_missing" });
      expect(await resolveEvidence(original, reissue({ content_digest: "0".repeat(64) }))).toMatchObject({ ok: false, reason: "content_changed" });
    });
  });
});

describe("structured data", () => {
  it("keeps hostile keys inert and never resolves inherited properties", () => {
    const json = parseJson('{"__proto__":{"polluted":true},"a":{"b":1}}') as Record<string, unknown>;
    const yaml = parseYaml("constructor:\n  prototype: x\nlist: [1, 2]\n") as Record<string, unknown>;

    expect(Object.getPrototypeOf(json)).toBeNull();
    expect(Object.keys(json)).toEqual(["__proto__", "a"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(valueAt(json as never, "/constructor")).toBeUndefined();
    expect(valueAt(yaml as never, "/constructor/prototype")).toBe("x");
    expect(valueAt(parseJson("{}"), "/toString")).toBeUndefined();
  });

  it("loads YAML custom tags as plain data and refuses alias bombs and duplicate keys", () => {
    expect(parseYaml('run: !!js/function "function () { return 1 }"\n')).toEqual({ run: "function () { return 1 }" });
    const bomb = "a: &a [x,x,x,x,x,x,x,x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]\nd: [*c,*c,*c,*c,*c,*c,*c,*c,*c]\n";
    expect(() => parseYaml(bomb)).toThrow(StructuredParseError);
    expect(() => parseYaml("a: 1\na: 2\n")).toThrow(StructuredParseError);
    expect(() => parseJson("{bad json")).toThrow(StructuredParseError);
  });

  it("escapes and resolves RFC 6901 pointers", () => {
    const value = parseJson('{"a/b":{"~c":[10,20]}}');

    expect(pointerOf(["a/b", "~c", 1])).toBe("/a~1b/~0c/1");
    expect(valueAt(value, "/a~1b/~0c/1")).toBe(20);
    expect(valueAt(value, "/a~1b/~0c/01")).toBeUndefined();
    expect(valueAt(value, "no-leading-slash")).toBeUndefined();
    expect(pointerLines('{\n  "a": {\n    "b": 1\n  }\n}\n', "/a/b")).toEqual({ start: 3, end: 3 });
  });
});
