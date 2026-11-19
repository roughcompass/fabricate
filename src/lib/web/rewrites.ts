/*
 * Rewrites for agents reading the docs (establish-frontend-registry, design
 * decision 13). A docs page's address followed by `.md`, and its address
 * requested with `Accept: text/markdown`, answer with the page's Markdown
 * from its route handler. They run before any page, so a docs page is never
 * rendered for them. This module imports nothing, because the Next.js
 * configuration loads it.
 */

export interface Rewrite {
  source: string;
  destination: string;
  has?: { type: "header"; key: string; value: string }[];
}

const ACCEPTS_MARKDOWN = [{ type: "header" as const, key: "accept", value: "(.*)text/markdown(.*)" }];

export const DOCS_REWRITES: Rewrite[] = [
  { source: "/docs/:path(.+)\\.md", destination: "/api/docs/:path" },
  { source: "/docs", has: ACCEPTS_MARKDOWN, destination: "/api/docs" },
  { source: "/docs/:path*", has: ACCEPTS_MARKDOWN, destination: "/api/docs/:path*" },
];
