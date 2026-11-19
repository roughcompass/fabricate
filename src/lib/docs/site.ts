import fs from "node:fs";
import path from "node:path";
import { StructuredParseError, parseYaml } from "@repo-facts/contract";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { PRODUCT } from "@/lib/product";
import { type RenderedDoc, renderMarkdown, rewriteLinks } from "./render";

/*
 * The docs (establish-frontend-registry, design decisions 13 and 15). The
 * manifest `docs/site.yaml` lists the sections, Get started, Concepts,
 * Guides, Reference, and Operate, and each section's pages in reading order,
 * each with its title and one-sentence summary. A page is either a Markdown
 * file of the Frontend Registry's own, at `docs/site/<path>.md`, so relative
 * links between pages work on disk and at the pages' `.md` addresses alike,
 * or a file a Surveyor package ships, such as `@repo-facts/contract`'s
 * `docs/detector-contract.md`, read from the installed release. Every page
 * says which release it describes. Engineering notes elsewhere in `docs/`
 * aren't listed, and aren't served.
 */

export const MANIFEST_FILE = "docs/site.yaml";
export const SITE_DIRECTORY = "docs/site";

const segment = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase words joined by hyphens");
const pageSchema = z.strictObject({
  path: segment,
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  /** A page a Surveyor package ships: the package, and the file within it. */
  package: z.string().regex(/^@repo-facts\/[a-z-]+$/, "must be a @repo-facts package").optional(),
  file: z.string().regex(/^[a-z0-9/_-]+\.md$/, "must be a Markdown file in the package").optional(),
});
const manifestSchema = z.strictObject({
  /** What the docs describe, in one paragraph, for `llms.txt`. */
  summary: z.string().trim().min(1),
  sections: z.array(z.strictObject({ id: segment, title: z.string().trim().min(1), pages: z.array(pageSchema).min(1) })).min(1),
});

export type DocsSource = { readonly kind: "docs"; readonly file: string } | { readonly kind: "package"; readonly package: string; readonly file: string };

export interface DocsPage {
  /** Its path under /docs, such as `get-started/add-your-repository`. */
  readonly path: string;
  /** Its address, such as `/docs/get-started/add-your-repository`. */
  readonly href: string;
  /** Its Markdown's address: the same, ending in `.md`. */
  readonly markdownHref: string;
  readonly title: string;
  /** One sentence that says what the page is for. */
  readonly summary: string;
  readonly section: { readonly id: string; readonly title: string };
  /** Where its Markdown comes from. A docs file is named from the app root. */
  readonly source: DocsSource;
}

export interface DocsSection {
  readonly id: string;
  readonly title: string;
  readonly pages: readonly DocsPage[];
}

export interface DocsSite {
  readonly summary: string;
  readonly sections: readonly DocsSection[];
  /** Every page, in reading order. */
  readonly pages: readonly DocsPage[];
  /** The app root the docs files are named from. */
  readonly root: string;
  /** Where each Surveyor package is installed. */
  readonly packageDirectory: (name: string) => string;
}

export interface Release {
  /** The part whose release a page describes: the Frontend Registry, or Surveyor. */
  readonly name: string;
  readonly version: string;
}

/** A docs page, read and rendered. */
export interface DocPage {
  readonly page: DocsPage;
  /** Its Markdown as its `.md` address serves it (`servedMarkdown`), for Copy page. */
  readonly markdown: string;
  readonly release: Release;
  readonly article: RenderedDoc;
  readonly previous: DocsPage | null;
  readonly next: DocsPage | null;
}

export class DocsError extends Error {
  override name = "DocsError";
}

export interface LoadOptions {
  /** Where a Surveyor package is installed; under the app root's node_modules by default. */
  packageDirectory?: (name: string) => string;
}

/** Reads and validates the manifest under +root+. */
export function loadDocsSite(root: string, options: LoadOptions = {}): DocsSite {
  let value: unknown;
  try {
    value = parseYaml(fs.readFileSync(/*turbopackIgnore: true*/ path.join(root, MANIFEST_FILE), "utf8"));
  } catch (error) {
    if (error instanceof StructuredParseError || (error as NodeJS.ErrnoException).code === "ENOENT") throw new DocsError(`${MANIFEST_FILE} can't be read: ${(error as Error).message}`);
    throw error;
  }
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw new DocsError(`Invalid ${MANIFEST_FILE}:\n${z.prettifyError(parsed.error)}`);

  const seen = new Set<string>();
  const sections = parsed.data.sections.map((section): DocsSection => ({
    id: section.id,
    title: section.title,
    pages: section.pages.map((entry): DocsPage => {
      const pagePath = `${section.id}/${entry.path}`;
      if (seen.has(pagePath)) throw new DocsError(`${MANIFEST_FILE} lists ${pagePath} twice`);
      seen.add(pagePath);
      if ((entry.package === undefined) !== (entry.file === undefined)) throw new DocsError(`${MANIFEST_FILE}: ${pagePath} names a package and its file together, or neither`);
      const source: DocsSource = entry.package ? { kind: "package", package: entry.package, file: entry.file! } : { kind: "docs", file: `${SITE_DIRECTORY}/${pagePath}.md` };
      return { path: pagePath, href: `/docs/${pagePath}`, markdownHref: `/docs/${pagePath}.md`, title: entry.title, summary: entry.summary, section: { id: section.id, title: section.title }, source };
    }),
  }));
  const packageDirectory = options.packageDirectory ?? ((name: string) => path.join(/*turbopackIgnore: true*/ root, "node_modules", name));
  return { summary: parsed.data.summary, sections, pages: sections.flatMap((section) => section.pages), root, packageDirectory };
}

let loaded: DocsSite | undefined;

/** The docs the running release serves, read once. */
export function docsSite(): DocsSite {
  return (loaded ??= loadDocsSite(getConfig().appRoot));
}

/** The page at +pagePath+, such as `get-started/add-your-repository`, or the first page for an empty path. */
export function findPage(site: DocsSite, pagePath: string): DocsPage | undefined {
  const normalized = pagePath.replace(/^\/+|\/+$/g, "").replace(/\.md$/, "");
  return normalized === "" ? site.pages[0] : site.pages.find((page) => page.path === normalized);
}

/** The file a page's Markdown is read from. */
function fileOf(site: DocsSite, source: DocsSource): string {
  return source.kind === "docs" ? path.join(/*turbopackIgnore: true*/ site.root, source.file) : path.join(/*turbopackIgnore: true*/ site.packageDirectory(source.package), source.file);
}

/** The Markdown of +page+, exactly as written. */
export function pageMarkdown(site: DocsSite, page: DocsPage): string {
  return fs.readFileSync(/*turbopackIgnore: true*/ fileOf(site, page.source), "utf8");
}

/** The release +page+ describes: the Frontend Registry's own for its docs, and the installed package's for Surveyor's. */
export function pageRelease(site: DocsSite, page: DocsPage): Release {
  const directory = page.source.kind === "docs" ? site.root : site.packageDirectory(page.source.package);
  const manifest = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ path.join(directory, "package.json"), "utf8")) as { version: string };
  return { name: page.source.kind === "docs" ? PRODUCT.name : PRODUCT.surveyor, version: manifest.version };
}

/**
 * Where a link in +page+ points in the rendered article. A link to another
 * page's Markdown file, `docs/site/<path>.md`, becomes that page's address,
 * with its anchor, even for a page a Surveyor package ships; a link
 * within the page, to an address, or to another site stays as written. A
 * Surveyor page's link to a file the docs don't serve is left as text.
 */
export function resolvePageLink(site: DocsSite, page: DocsPage, href: string): string | null {
  if (href.startsWith("#") || href.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  const [target = "", anchor] = href.split("#", 2);
  const fragment = anchor === undefined ? "" : `#${anchor}`;
  if (page.source.kind === "docs") {
    // docs/site mirrors the pages' addresses, so a link to `<path>.md` there opens that page, wherever its Markdown is kept.
    const file = path.posix.normalize(path.posix.join(path.posix.dirname(page.source.file), target));
    const prefix = `${SITE_DIRECTORY}/`;
    const linked = file.startsWith(prefix) && file.endsWith(".md") ? site.pages.find((candidate) => candidate.path === file.slice(prefix.length, -".md".length)) : undefined;
    return linked ? `${linked.href}${fragment}` : href;
  }
  const { package: name, file: own } = page.source;
  const file = path.posix.normalize(path.posix.join(path.posix.dirname(own), target));
  const linked = site.pages.find((candidate) => candidate.source.kind === "package" && candidate.source.package === name && candidate.source.file === file);
  return linked ? `${linked.href}${fragment}` : null;
}

/**
 * The Markdown +page+ is served as, at its `.md` address, in `llms-full.txt`,
 * and by Copy page. A docs file is exactly as written, since `docs/site`
 * mirrors the addresses and its relative links open the same pages there. A
 * Surveyor page's links are relative to its package, so they take the
 * addresses its article gives them: another page's opens that page's
 * Markdown, and one to a file the docs don't serve is left as its text.
 */
export function servedMarkdown(site: DocsSite, page: DocsPage): string {
  const markdown = pageMarkdown(site, page);
  if (page.source.kind === "docs") return markdown;
  return rewriteLinks(markdown, (href) => {
    const resolved = resolvePageLink(site, page, href);
    if (resolved === null || resolved === href) return resolved;
    const [address, anchor] = resolved.split("#", 2);
    const linked = site.pages.find((candidate) => candidate.href === address);
    return linked ? `${linked.markdownHref}${anchor === undefined ? "" : `#${anchor}`}` : resolved;
  });
}

/**
 * The page at +pagePath+, read and rendered, with the pages before and after it.
 * @public The docs pages render through this.
 */
export function readDocPage(site: DocsSite, pagePath: string): DocPage | undefined {
  const page = findPage(site, pagePath);
  if (!page) return undefined;
  const index = site.pages.indexOf(page);
  const markdown = pageMarkdown(site, page);
  return {
    page,
    markdown: servedMarkdown(site, page),
    release: pageRelease(site, page),
    article: renderMarkdown(markdown, { resolveLink: (href) => resolvePageLink(site, page, href), keepSummary: page.source.kind === "package" }),
    previous: site.pages[index - 1] ?? null,
    next: site.pages[index + 1] ?? null,
  };
}
