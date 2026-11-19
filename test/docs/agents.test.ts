import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { GET as markdown } from "@/app/api/docs/[[...path]]/route";
import { GET as llmsFull } from "@/app/llms-full.txt/route";
import { GET as llms } from "@/app/llms.txt/route";
import { docsSite } from "@/lib/docs/site";
import { DOCS_REWRITES } from "@/lib/web/rewrites";

/*
 * Docs for agents (establish-frontend-registry, task 10.6; the product-site
 * requirement "The documentation is readable by agents"): each page's
 * Markdown at its `.md` address and for `Accept: text/markdown`, `/llms.txt`
 * in the llms.txt format, and `/llms-full.txt`.
 */

const ORIGIN = "https://registry.example";
const page = (path: string[]) => markdown(new Request(`${ORIGIN}/api/docs/${path.join("/")}`), { params: Promise.resolve({ path }) });

describe("docs for agents", () => {
  it("serves a page's Markdown source exactly as written (Markdown version of a page)", async () => {
    const response = await page(["get-started", "add-your-repository"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toBe(fs.readFileSync("docs/site/get-started/add-your-repository.md", "utf8"));
  });

  it("serves the first page for the docs' own address, and not found for an address that isn't a page", async () => {
    expect(await (await markdown(new Request(`${ORIGIN}/api/docs`), { params: Promise.resolve({}) })).text()).toMatch(/^# What the Frontend Registry is\n/);
    expect((await page(["get-started", "nowhere"])).status).toBe(404);
    expect((await page(["..", "architecture"])).status).toBe(404);
  });

  it("routes `.md` addresses and docs addresses that accept Markdown to the Markdown, and nothing else", () => {
    expect(DOCS_REWRITES).toEqual([
      { source: "/docs/:path(.+)\\.md", destination: "/api/docs/:path" },
      { source: "/docs", has: [{ type: "header", key: "accept", value: "(.*)text/markdown(.*)" }], destination: "/api/docs" },
      { source: "/docs/:path*", has: [{ type: "header", key: "accept", value: "(.*)text/markdown(.*)" }], destination: "/api/docs/:path*" },
    ]);
  });

  it("indexes every page by section, with its Markdown address and summary, in the llms.txt format (Index for agents)", async () => {
    const response = llms(new Request(`${ORIGIN}/llms.txt`));
    const text = await response.text();
    const site = docsSite();
    expect(text.split("\n").slice(0, 3)).toEqual(["# Frontend Registry", "", `> ${site.summary}`]);
    for (const section of site.sections) {
      expect(text).toContain(`\n## ${section.title}\n\n`);
      for (const listed of section.pages) expect(text).toContain(`- [${listed.title}](${ORIGIN}${listed.markdownHref}): ${listed.summary}\n`);
    }
    expect(text.indexOf("## Get started")).toBeLessThan(text.indexOf("## Operate"));
  });

  it("holds every page's Markdown in reading order in llms-full.txt", async () => {
    const text = await llmsFull(new Request(`${ORIGIN}/llms-full.txt`)).text();
    const site = docsSite();
    const positions = site.pages.map((listed) => text.indexOf(`<!-- ${ORIGIN}${listed.href} -->`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain(fs.readFileSync("docs/site/guides/use-with-your-agent.md", "utf8").trim());
  });

  it("names addresses on the host the request came to, or the one a proxy forwarded", async () => {
    expect(await llms(new Request("http://localhost:3100/llms.txt", { headers: { host: "127.0.0.1:3100" } })).text()).toContain("(http://127.0.0.1:3100/docs/get-started/what-it-is.md)");
    expect(await llms(new Request("http://10.0.0.5:3000/llms.txt", { headers: { host: "10.0.0.5:3000", "x-forwarded-host": "registry.example", "x-forwarded-proto": "https" } })).text()).toContain("(https://registry.example/docs/get-started/what-it-is.md)");
  });

  it("offers an AGENTS.md snippet that names the Frontend Registry, links llms.txt, and lists the sections' addresses (AGENTS.md snippet)", () => {
    const guide = fs.readFileSync("docs/site/guides/use-with-your-agent.md", "utf8");
    const snippet = /## Add it to your AGENTS\.md[\s\S]*?```markdown\n([\s\S]*?)```/.exec(guide)![1]!;
    expect(snippet).toContain("## Frontend Registry");
    expect(snippet).toContain("/llms.txt");
    for (const section of docsSite().sections) expect(snippet).toContain(`- ${section.title}: https://frontend-registry.example.com${section.pages[0]!.markdownHref}`);
  });
});
