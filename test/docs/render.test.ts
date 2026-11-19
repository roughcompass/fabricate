import { toHtml } from "hast-util-to-html";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/docs/render";

/*
 * Rendering a docs page's Markdown (establish-frontend-registry, task 10.2):
 * its title and summary for the page frame, and its article, with anchored
 * headings and a list of them, code blocks, and tables.
 */

const PAGE = `# Add your repository

Register your repository once, and the Frontend Registry surveys it.

## Add it

Open [New Repository](/repositories/new) and read [Profiles](../concepts/profiles-and-recipes.md#a-recipe).

### Add it

A heading repeated gets its own anchor.

## What \`profile.json\` holds

\`\`\`sh
curl https://registry.example/repositories/src_0123456789abcdef/profile.json
\`\`\`

\`\`\`
no language
\`\`\`

| Header | Holds |
| --- | --- |
| \`Digest\` | The SHA-256 of the body |

<script>alert("raw HTML is left out")</script>
`;

describe("rendering a docs page", () => {
  const doc = renderMarkdown(PAGE);
  const html = toHtml(doc.tree);

  it("takes the title and the one-sentence summary out for the page frame", () => {
    expect(doc.title).toBe("Add your repository");
    expect(doc.summary).toBe("Register your repository once, and the Frontend Registry surveys it.");
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("Register your repository once");
  });

  it("gives each heading the anchor GitHub gives it, and lists the headings for the contents", () => {
    expect(doc.headings).toEqual([
      { depth: 2, id: "add-it", text: "Add it" },
      { depth: 3, id: "add-it-1", text: "Add it" },
      { depth: 2, id: "what-profilejson-holds", text: "What profile.json holds" },
    ]);
    expect(html).toContain('<h2 id="add-it">Add it</h2>');
    expect(html).toContain('<h3 id="add-it-1">Add it</h3>');
    expect(html).toContain('<h2 id="what-profilejson-holds">What <code>profile.json</code> holds</h2>');
    expect([...doc.anchors]).toEqual(["add-it", "add-it-1", "what-profilejson-holds"]);
  });

  it("renders code blocks with their language, and without one when none is given", () => {
    expect(html).toContain('<pre><code class="language-sh">curl https://registry.example/repositories/src_0123456789abcdef/profile.json\n</code></pre>');
    expect(html).toContain("<pre><code>no language\n</code></pre>");
  });

  it("renders GitHub tables", () => {
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Header</th>");
    expect(html).toContain("<td><code>Digest</code></td>");
  });

  it("leaves raw HTML out", () => {
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert");
  });

  it("resolves links, and leaves a link as text when it can't be resolved", () => {
    expect(doc.links.map((link) => [link.href, link.line])).toEqual([
      ["/repositories/new", 7],
      ["../concepts/profiles-and-recipes.md#a-recipe", 7],
    ]);
    const resolved = renderMarkdown(PAGE, { resolveLink: (href) => (href.startsWith("../") ? null : `${href}?from=docs`) });
    const out = toHtml(resolved.tree);
    expect(out).toContain('<a href="/repositories/new?from=docs">New Repository</a>');
    expect(out).toContain("read Profiles.");
    expect(resolved.links[1]).toMatchObject({ resolved: null });
  });

  it("keeps the first paragraph in the article for a page whose frame shows another summary", () => {
    const kept = toHtml(renderMarkdown("# Detector Contract\n\nThis contract governs detectors.\n\n## Stages\n", { keepSummary: true }).tree);
    expect(kept).toContain("<p>This contract governs detectors.</p>");
    expect(kept).not.toContain("<h1");
  });
});
