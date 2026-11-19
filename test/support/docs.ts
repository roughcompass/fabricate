import fs from "node:fs";
import path from "node:path";
import { renderMarkdown } from "@/lib/docs/render";
import { type DocsPage, type DocsSite, SITE_DIRECTORY, findPage, pageMarkdown, resolvePageLink } from "@/lib/docs/site";

/*
 * The docs test (establish-frontend-registry, task 10.4; the product-site
 * scenario "Broken link"): every page in the manifest has a title and a
 * one-sentence summary that its file opens with, every link between pages
 * opens a page that exists, at a heading it has, and every page under
 * docs/site is listed. A Surveyor package's pages are checked for their
 * links to each other only, since their other links point into Surveyor's
 * repository and are left as text.
 */

export interface DocsProblem {
  /** The page's address, such as /docs/get-started/add-your-repository. */
  readonly page: string;
  /** The link as written, when the problem is a link. */
  readonly link?: string;
  readonly problem: string;
}

/** The top-level paths of the app's pages and addresses a docs page may link to. */
// Adoption's pages join this list when they exist (task 6.4); until then the docs name them without a link.
const APP_ROUTES = ["/", "/repositories", "/assessments", "/runs", "/evaluations", "/standards", "/profiles", "/admin", "/templates", "/about", "/docs", "/llms.txt", "/llms-full.txt"];

/** Whether +text+ is one sentence: it ends with a period, and no sentence ends before it. */
export function isOneSentence(text: string): boolean {
  return /^[A-Z][\s\S]*\.$/.test(text) && !/[.!?]\s+[A-Z]/.test(text.slice(0, -1));
}

/** Every problem with +site+'s pages and links. */
export function docsProblems(site: DocsSite): DocsProblem[] {
  const problems: DocsProblem[] = [];
  const rendered = new Map(site.pages.map((page) => [page.path, renderMarkdown(pageMarkdown(site, page), { keepSummary: page.source.kind === "package" })]));

  for (const page of site.pages) {
    const add = (problem: string, link?: string) => problems.push({ page: page.href, ...(link !== undefined && { link }), problem });
    const doc = rendered.get(page.path)!;
    if (!isOneSentence(page.summary)) add(`its summary isn't one sentence: "${page.summary}"`);
    if (page.source.kind === "docs") {
      if (doc.title !== page.title) add(`its file's title, "${doc.title ?? "(none)"}", isn't the manifest's, "${page.title}"`);
      if (doc.summary !== page.summary) add(`its file's first paragraph isn't the manifest's summary`);
    }
    for (const link of doc.links) {
      const resolved = resolvePageLink(site, page, link.href);
      const at = `${link.href} (line ${link.line})`;
      if (resolved === null || /^[a-z][a-z0-9+.-]*:/i.test(link.href)) continue;
      const [target = "", anchor] = resolved.split("#", 2);
      if (target === "") {
        if (anchor !== undefined && !doc.anchors.has(anchor)) add(`links to #${anchor}, which isn't a heading of this page`, at);
        continue;
      }
      if (target.startsWith("/docs")) {
        const linked = findPage(site, target.slice("/docs".length));
        if (!linked) add(`links to ${target}, which isn't a docs page`, at);
        else if (anchor !== undefined && !rendered.get(linked.path)!.anchors.has(anchor)) add(`links to #${anchor} of ${linked.href}, which has no such heading`, at);
        continue;
      }
      if (target.startsWith("/")) {
        if (!APP_ROUTES.some((route) => target === route || (route !== "/" && target.startsWith(`${route}/`)))) add(`links to ${target}, which isn't an address the Frontend Registry serves`, at);
        continue;
      }
      add(`links to ${link.href}, which isn't a docs page`, at);
    }
  }

  const listed = new Set(site.pages.filter((page): page is DocsPage & { source: { kind: "docs" } } => page.source.kind === "docs").map((page) => page.source.file));
  for (const file of markdownFiles(path.join(site.root, SITE_DIRECTORY))) {
    const relative = path.relative(site.root, file).split(path.sep).join("/");
    if (!listed.has(relative)) problems.push({ page: relative, problem: "isn't listed in docs/site.yaml" });
  }
  return problems;
}

function markdownFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(full) : entry.name.endsWith(".md") ? [full] : [];
  });
}
