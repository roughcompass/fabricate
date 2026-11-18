import { beforeAll, describe, expect, it } from "vitest";
import { repositoryKind } from "@/lib/profiles/kind";
import type { FactDocument } from "@/lib/profiles/states";
import { analyzedFacts, factDocumentFixture } from "../../support/fact-documents";
import { manifest } from "../../support/profiles";

describe("Whether a repository is a frontend web repository", () => {
  let service: FactDocument;
  let infrastructure: FactDocument;
  beforeAll(async () => {
    service = await analyzedFacts({ "package.json": manifest({ name: "payments", dependencies: { express: "^4.21.0" } }), "src/server.ts": 'import express from "express";\nexpress().listen(3000);\n' });
    infrastructure = await analyzedFacts({ "main.tf": 'resource "aws_s3_bucket" "logs" {}\n', "variables.tf": 'variable "region" {}\n', "README.md": "# Infrastructure\n" });
  });

  it("is one when it uses a UI framework, composes with others, or renders UI elements, and names what decided it", () => {
    const shell = repositoryKind(factDocumentFixture("federation-shell") as unknown as FactDocument);
    expect(shell.frontend).toBe(true);
    expect(shell.signals).toEqual(expect.arrayContaining(["a composition mechanism"]));
    expect(repositoryKind(factDocumentFixture("salt-application") as unknown as FactDocument).signals).toEqual(expect.arrayContaining(["React", "a design system", "UI elements"]));
  });

  it("is one when it's mostly markup and stylesheets, even without a framework", async () => {
    const site = await analyzedFacts({ "index.html": "<!doctype html>\n<html lang=\"en\"></html>\n", "about.html": "<!doctype html>\n", "styles.css": "body { margin: 0 }\n", "app.js": "console.log(1);\n" });
    expect(repositoryKind(site)).toMatchObject({ frontend: true, signals: ["mostly markup and stylesheets"] });
  });

  it("isn't one for a server or infrastructure repository, which is named by its main languages", () => {
    expect(repositoryKind(service)).toMatchObject({ frontend: false, signals: [] });
    expect(repositoryKind(infrastructure)).toMatchObject({ frontend: false, signals: [], languages: [expect.stringMatching(/^Terraform \(2 files\)$/)] });
  });
});
