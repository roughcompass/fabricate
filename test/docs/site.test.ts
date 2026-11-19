import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocsError, loadDocsSite, readDocPage } from "@/lib/docs/site";
import { PRODUCT } from "@/lib/product";
import frontendRegistryPackage from "../../package.json";
import { docsProblems, isOneSentence } from "../support/docs";

/*
 * The docs test (establish-frontend-registry, task 10.4): every page in
 * docs/site.yaml has a title and a one-sentence summary, every link between
 * pages and every heading anchor resolves, and the test fails, naming the
 * page and the link, when one doesn't (the product-site scenario "Broken
 * link"). Pages have the frame the product-site spec gives them (task 10.2).
 */

const SECTIONS = ["Get started", "Concepts", "Guides", "Reference", "Operate"];

describe("the shipped docs", () => {
  const site = loadDocsSite(process.cwd());

  it("have the five sections, Get started first, opening with what the Frontend Registry is", () => {
    expect(site.sections.map((section) => section.title)).toEqual(SECTIONS);
    expect(site.pages[0]).toMatchObject({ path: "get-started/what-it-is", title: `What the ${PRODUCT.name} is`, href: "/docs/get-started/what-it-is", markdownHref: "/docs/get-started/what-it-is.md" });
  });

  it("have no broken link or anchor, no unlisted page, and a title and one-sentence summary on every page", () => {
    expect(docsProblems(site)).toEqual([]);
    for (const page of site.pages) {
      expect(page.title.length, page.path).toBeGreaterThan(0);
      expect(isOneSentence(page.summary), page.summary).toBe(true);
    }
  });

  it("give every page its title, summary, contents, previous and next pages, and the release it describes (Page frame)", () => {
    const page = readDocPage(site, "get-started/add-your-repository")!;
    expect(page.article).toMatchObject({ title: "Add your repository", summary: page.page.summary });
    expect(page.article.headings.map((heading) => heading.text)).toEqual(["Add it", "What happens next", "If the survey fails", "Change or remove it"]);
    expect(page.previous?.path).toBe("get-started/what-it-is");
    expect(page.next?.path).toBe("get-started/find-and-read-a-profile");
    expect(page.release).toEqual({ name: PRODUCT.name, version: frontendRegistryPackage.version });
    expect(readDocPage(site, "")!.page.path).toBe("get-started/what-it-is");
    expect(readDocPage(site, site.pages.at(-1)!.path)!.next).toBeNull();
    expect(readDocPage(site, "get-started/nowhere")).toBeUndefined();
  });

  it("render Surveyor's reference from the installed package, labeled with its release", () => {
    const page = readDocPage(site, "reference/fact-document")!;
    const installed = (JSON.parse(fs.readFileSync("node_modules/@repo-facts/contract/package.json", "utf8")) as { version: string }).version;
    expect(page.release).toEqual({ name: PRODUCT.surveyor, version: installed });
    // Its Markdown, for Copy page, is the package's, with the links its article has.
    expect(page.markdown.startsWith(fs.readFileSync("node_modules/@repo-facts/contract/docs/detector-contract.md", "utf8").split("\n")[0]!)).toBe(true);
    expect(page.markdown).toContain("see [reference-catalog.md](/docs/reference/entry-format.md)");
    expect(page.markdown).not.toContain("](../packages/");
    // A link to the other page the package ships opens it; a link into Surveyor's repository is left as text.
    const links = page.article.links.map((link) => link.resolved);
    expect(links).toContain("/docs/reference/entry-format");
    expect(links).not.toContain("../packages/contract/src/detectors/contract.ts");
  });

  it("follow the reading order across sections", () => {
    const paths = site.pages.map((page) => page.path);
    expect(paths.slice(0, 4)).toEqual(["get-started/what-it-is", "get-started/add-your-repository", "get-started/find-and-read-a-profile", "get-started/see-adoption"]);
    expect(readDocPage(site, "get-started/see-adoption")!.next?.path).toBe("concepts/four-parts");
  });
});

describe("the docs test", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-registry-docs-"));
    fs.mkdirSync(path.join(root, "docs/site/guides"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs/site.yaml"),
      "summary: Docs for a test.\nsections:\n  - id: guides\n    title: Guides\n    pages:\n      - path: one\n        title: One\n        summary: The first page.\n      - path: two\n        title: Two\n        summary: The second page.\n",
    );
    fs.writeFileSync(path.join(root, "docs/site/guides/two.md"), "# Two\n\nThe second page.\n\n## Reading order\n\nText.\n");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const one = (body: string) => fs.writeFileSync(path.join(root, "docs/site/guides/one.md"), `# One\n\nThe first page.\n\n## Start\n\n${body}\n`);

  it("passes when every link and anchor resolves", () => {
    one("See [the order](two.md#reading-order), [Start](#start), and [Repositories](/repositories).");
    expect(docsProblems(loadDocsSite(root))).toEqual([]);
  });

  it("fails on a link to a heading that no longer exists, naming the page and the link (Broken link)", () => {
    one("See [the order](two.md#order).");
    expect(docsProblems(loadDocsSite(root))).toEqual([{ page: "/docs/guides/one", link: "two.md#order (line 7)", problem: "links to #order of /docs/guides/two, which has no such heading" }]);
  });

  it("fails on a link to a missing page, a missing anchor, or an address the app doesn't serve", () => {
    one("See [three](three.md), [nowhere](#nowhere), [the docs](/docs/guides/three), and [old](/claims).");
    expect(docsProblems(loadDocsSite(root)).map((problem) => problem.problem)).toEqual([
      "links to three.md, which isn't a docs page",
      "links to #nowhere, which isn't a heading of this page",
      "links to /docs/guides/three, which isn't a docs page",
      "links to /claims, which isn't an address the Frontend Registry serves",
    ]);
  });

  it("fails on a title or summary that doesn't match the manifest, a summary of two sentences, and an unlisted page", () => {
    fs.writeFileSync(path.join(root, "docs/site/guides/one.md"), "# The one\n\nThe first page. It has two sentences.\n");
    fs.writeFileSync(path.join(root, "docs/site/guides/stray.md"), "# Stray\n\nNot listed.\n");
    expect(docsProblems(loadDocsSite(root)).map((problem) => `${problem.page}: ${problem.problem}`)).toEqual([
      '/docs/guides/one: its file\'s title, "The one", isn\'t the manifest\'s, "One"',
      "/docs/guides/one: its file's first paragraph isn't the manifest's summary",
      "docs/site/guides/stray.md: isn't listed in docs/site.yaml",
    ]);
    expect(isOneSentence("The first page. It has two sentences.")).toBe(false);
    expect(isOneSentence("Uses `profile.json`, e.g. for agents.")).toBe(true);
  });

  it("refuses a manifest with an unknown key, a page listed twice, or a page without a summary", () => {
    const manifest = path.join(root, "docs/site.yaml");
    fs.writeFileSync(manifest, "summary: S.\nsections:\n  - id: guides\n    title: Guides\n    owner: de\n    pages:\n      - { path: one, title: One, summary: The first page. }\n");
    expect(() => loadDocsSite(root)).toThrow(DocsError);
    fs.writeFileSync(manifest, "summary: S.\nsections:\n  - id: guides\n    title: Guides\n    pages:\n      - { path: one, title: One, summary: The first page. }\n      - { path: one, title: Again, summary: Again. }\n");
    expect(() => loadDocsSite(root)).toThrow(/lists guides\/one twice/);
    fs.writeFileSync(manifest, "summary: S.\nsections:\n  - id: guides\n    title: Guides\n    pages:\n      - { path: one, title: One }\n");
    expect(() => loadDocsSite(root)).toThrow(/summary/);
  });

  it("labels a Surveyor page with the release installed, so an upgrade shows the new version (Surveyor upgrade)", () => {
    const install = (version: string, text: string) => {
      const directory = path.join(root, "packages", version);
      fs.mkdirSync(path.join(directory, "docs"), { recursive: true });
      fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "@repo-facts/contract", version }));
      fs.writeFileSync(path.join(directory, "docs/detector-contract.md"), text);
      return directory;
    };
    fs.writeFileSync(path.join(root, "docs/site.yaml"), "summary: S.\nsections:\n  - id: reference\n    title: Reference\n    pages:\n      - path: fact-document\n        title: Fact document\n        summary: The fact document.\n        package: \"@repo-facts/contract\"\n        file: docs/detector-contract.md\n");
    fs.rmSync(path.join(root, "docs/site"), { recursive: true });
    const before = install("0.7.0", "# Detector Contract\n\nVersion 3 of the fact document.\n");
    const after = install("0.8.0", "# Detector Contract\n\nVersion 4 of the fact document.\n");

    const page = (directory: string) => readDocPage(loadDocsSite(root, { packageDirectory: () => directory }), "reference/fact-document")!;
    expect(page(before)).toMatchObject({ release: { name: PRODUCT.surveyor, version: "0.7.0" }, markdown: expect.stringContaining("Version 3") });
    expect(page(after)).toMatchObject({ release: { name: PRODUCT.surveyor, version: "0.8.0" }, markdown: expect.stringContaining("Version 4") });
  });
});
