import fs from "node:fs";
import { sha256 } from "@repo-facts/contract";
import { buildRepository } from "../test/support/builders";
import { manifest } from "../test/support/profiles";
import { seedSurvey } from "../test/support/scenarios";
import { expect, test } from "./support/fixtures";

/*
 * What agents read (establish-frontend-registry, tasks 10.6 and 10.7): each
 * docs page's Markdown at its `.md` address and for `Accept: text/markdown`,
 * the llms.txt index and full text, and a Repository's current Profile as
 * JSON, through the running server and its rewrites.
 */

const ADD = fs.readFileSync("docs/site/get-started/add-your-repository.md", "utf8");

test("serves a docs page's Markdown at its .md address (Markdown version of a page)", async ({ request }) => {
  const response = await request.get("/docs/get-started/add-your-repository.md");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("text/markdown; charset=utf-8");
  expect(await response.text()).toBe(ADD);
  expect((await request.get("/docs/get-started/nowhere.md")).status()).toBe(404);
});

test("serves a docs page's Markdown at its own address to a request that accepts Markdown (Markdown by content negotiation)", async ({ request }) => {
  const response = await request.get("/docs/get-started/add-your-repository", { headers: { Accept: "text/markdown" } });
  expect(response.headers()["content-type"]).toBe("text/markdown; charset=utf-8");
  expect(await response.text()).toBe(ADD);
  expect(await (await request.get("/docs", { headers: { Accept: "text/markdown, text/plain;q=0.5" } })).text()).toMatch(/^# What the Frontend Registry is\n/);
});

test("indexes the docs for agents in llms.txt, with every page in llms-full.txt (Index for agents)", async ({ request, baseURL }) => {
  const index = await (await request.get("/llms.txt")).text();
  expect(index).toMatch(/^# Frontend Registry\n\n> /);
  expect(index).toContain(`- [Add your repository](${baseURL}/docs/get-started/add-your-repository.md): Register your repository once`);
  for (const section of ["Get started", "Concepts", "Guides", "Reference", "Operate"]) expect(index).toContain(`\n## ${section}\n`);
  const full = await (await request.get("/llms-full.txt")).text();
  expect(full).toContain(ADD.trim());
});

test("serves a Repository's current Profile's fact document with its digest (A Profile for an agent)", async ({ request, db }) => {
  const web = buildRepository(db, { name: "web" });
  await seedSurvey(db, web, { files: { "package.json": manifest({ name: "web", version: "1.0.0", dependencies: { react: "19.3.1" } }) } });

  const response = await request.get(`/repositories/${web.publicId}/profile.json`);
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(response.headers().digest).toBe(sha256(body));
  expect(JSON.parse(body)).toMatchObject({ schema: "repo_facts.fact_document", schema_version: 3 });
  expect((await request.get("/repositories/src_0000000000000000/profile.json")).status()).toBe(404);
});
