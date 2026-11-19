import fs from "node:fs";
import path from "node:path";
import { factDocumentProblems } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { FACT_DOCUMENT_FIXTURES, factDocumentFixture } from "../support/fact-documents";

describe("Golden fact documents from Surveyor", () => {
  it("names the Surveyor release and commit each document was copied from", () => {
    const source = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", "fact-documents", "SOURCE.json"), "utf8"));
    expect(source).toMatchObject({ repository: "repo-facts", release: "0.6.0", commit: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(Object.keys(source.files).sort()).toEqual(FACT_DOCUMENT_FIXTURES.map((name) => `${name}.json`));
  });

  it.each(FACT_DOCUMENT_FIXTURES)("validates %s with the installed contract", (name) => {
    expect(factDocumentProblems(factDocumentFixture(name))).toEqual([]);
  });
});
