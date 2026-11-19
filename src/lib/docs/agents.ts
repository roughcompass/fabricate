import { PRODUCT } from "@/lib/product";
import { type DocsSite, servedMarkdown } from "./site";

/*
 * The docs for agents (establish-frontend-registry, design decision 13; the
 * product-site requirement "The documentation is readable by agents"):
 * `/llms.txt` indexes every page in the llms.txt format (https://llmstxt.org):
 * the product's name, a summary, and each section's pages with their
 * Markdown addresses and summaries; `/llms-full.txt` holds every page's
 * Markdown, in reading order.
 */

/** The llms.txt index of +site+, with addresses on +origin+, such as `https://registry.example`. */
export function llmsTxt(site: DocsSite, origin: string): string {
  const lines = [`# ${PRODUCT.name}`, "", `> ${site.summary.replace(/\s+/g, " ").trim()}`, "", `Every page is Markdown at its address. All of them, in reading order, are at ${origin}/llms-full.txt.`];
  for (const section of site.sections) {
    lines.push("", `## ${section.title}`, "");
    for (const page of section.pages) lines.push(`- [${page.title}](${origin}${page.markdownHref}): ${page.summary}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Every page's Markdown, in reading order, each preceded by its address on +origin+. */
export function llmsFullTxt(site: DocsSite, origin: string): string {
  return site.pages.map((page) => `<!-- ${origin}${page.href} -->\n\n${servedMarkdown(site, page).trim()}\n`).join("\n");
}

/**
 * The address +request+ was made to, such as `https://registry.example`: the
 * host and scheme a proxy forwarded, else the ones the request names, so the
 * index's addresses work for the agent that asked.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const first = (name: string) => request.headers.get(name)?.split(",")[0]?.trim() || null;
  const host = first("x-forwarded-host") ?? first("host") ?? url.host;
  const protocol = first("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  return `${protocol}://${host}`;
}
