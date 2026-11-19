import GithubSlugger from "github-slugger";
import type { Root as HastRoot } from "hast";
import type { Heading as MdastHeading, Root as MdastRoot, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

/*
 * Docs pages from Markdown (establish-frontend-registry, design decision 13;
 * the product-site requirement "Every docs page has the same frame"). A page
 * is CommonMark with GitHub tables, and no MDX or raw HTML: raw HTML is left
 * out. It opens with its title as the only `#` heading and a one-sentence
 * summary, which the page frame shows, so the article is what follows.
 * A page a Surveyor package ships keeps its first paragraph in the article,
 * because its frame shows the manifest's summary instead.
 * Headings get the anchors GitHub gives them, and links between pages are
 * resolved to the pages' addresses.
 */

export interface DocHeading {
  /** 2 to 6: the article's own headings, below the page's title. */
  readonly depth: number;
  /** Its anchor, as GitHub makes one from its text. */
  readonly id: string;
  readonly text: string;
}

export interface DocLink {
  /** The address as the Markdown wrote it. */
  readonly href: string;
  /** Where the rendered article points it, or null when it was left as text. */
  readonly resolved: string | null;
  /** The line it's on. */
  readonly line: number;
}

export interface RenderedDoc {
  /** The `#` heading's text, or null when the page has none. */
  readonly title: string | null;
  /** The paragraph right after the title, as text. */
  readonly summary: string | null;
  /** The article after the title and summary, as a HAST tree: anchored headings, code blocks with their language as `language-*` classes, and tables. */
  readonly tree: HastRoot;
  /** The article's headings, in order, for its contents list. */
  readonly headings: readonly DocHeading[];
  /** Every anchor a link can point at: each heading's id. */
  readonly anchors: ReadonlySet<string>;
  /** Every link in the page, title and summary included. */
  readonly links: readonly DocLink[];
}

export interface RenderOptions {
  /**
   * Where a link points in the rendered article. Returns the address to
   * use, or null to leave the link as text. By default, links stay as written.
   */
  resolveLink?: (href: string) => string | null;
  /** Keep the paragraph after the title in the article, for a page whose frame shows a summary from elsewhere, such as one a Surveyor package ships. */
  keepSummary?: boolean;
}

/** A Markdown node's text, as it reads: inline code and link text included, markup left out. */
function textOf(node: unknown): string {
  const { value, children } = node as { value?: unknown; children?: unknown[] };
  return typeof value === "string" ? value : (children ?? []).map(textOf).join("");
}

/**
 * +markdown+ with each link's address replaced as +map+ says, everything
 * else exactly as written: a new address, or null to leave an inline link's
 * text alone, as `renderMarkdown` does. A link definition that maps to null
 * keeps its address, since it has no text of its own.
 */
export function rewriteLinks(markdown: string, map: (href: string) => string | null): string {
  const mdast = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const edits: { start: number; end: number; text: string }[] = [];
  const slice = (start: number | undefined, end: number | undefined) => (start === undefined || end === undefined ? "" : markdown.slice(start, end));
  visit(mdast, (node) => {
    if (node.type !== "link" && node.type !== "definition") return;
    const target = map(node.url);
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (target === node.url || start === undefined || end === undefined) return;
    const title = node.title ? ` "${node.title}"` : "";
    if (node.type === "definition") {
      if (target !== null) edits.push({ start, end, text: `[${node.label ?? node.identifier}]: ${target}${title}` });
      return;
    }
    const label = slice(node.children[0]?.position?.start.offset, node.children.at(-1)?.position?.end.offset);
    edits.push({ start, end, text: target === null ? label : `[${label}](${target}${title})` });
  });
  return edits.sort((a, b) => b.start - a.start).reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), markdown);
}

/** Renders a docs page's Markdown into its title, summary, and article. */
export function renderMarkdown(markdown: string, options: RenderOptions = {}): RenderedDoc {
  const mdast = unified().use(remarkParse).use(remarkGfm).parse(markdown);

  const links: DocLink[] = [];
  visit(mdast, (node, index, parent) => {
    if ((node.type !== "link" && node.type !== "definition") || typeof index !== "number" || !parent) return;
    const resolved = options.resolveLink ? options.resolveLink(node.url) : node.url;
    links.push({ href: node.url, resolved, line: node.position?.start.line ?? 0 });
    if (resolved !== null) node.url = resolved;
    else if (node.type === "link") {
      parent.children.splice(index, 1, ...node.children);
      return index;
    }
    return undefined;
  });

  // The title and its summary belong to the page frame, not the article.
  const children = [...mdast.children];
  const titleIndex = children.findIndex((node) => node.type === "heading" && node.depth === 1);
  let title: string | null = null;
  let summary: string | null = null;
  if (titleIndex !== -1) {
    title = textOf(children[titleIndex]!).trim();
    const next = children[titleIndex + 1];
    if (next?.type === "paragraph") summary = textOf(next).replace(/\s+/g, " ").trim();
    children.splice(titleIndex, next?.type === "paragraph" && !options.keepSummary ? 2 : 1);
  }
  const article: MdastRoot = { type: "root", children: children as RootContent[] };

  // Anchors are counted over the whole page, as GitHub counts them, title included.
  const slugger = new GithubSlugger();
  if (title !== null) slugger.slug(title);
  const headings: DocHeading[] = [];
  visit(article, "heading", (node: MdastHeading) => {
    const text = textOf(node).trim();
    const id = slugger.slug(text);
    node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
    headings.push({ depth: node.depth, id, text });
  });

  // Raw HTML in the Markdown is dropped: remark-rehype keeps it only when asked to.
  const tree = unified().use(remarkRehype).runSync(article);
  return { title, summary, tree, headings, anchors: new Set(headings.map((heading) => heading.id)), links };
}
