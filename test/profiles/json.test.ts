import { dump, sha256 } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/(operator)/repositories/[repositoryId]/profile.json/route";
import { currentProfile } from "@/lib/profiling/current";
import { profileDocument } from "@/lib/profiles/profile-records";
import { deleteRepository } from "@/lib/repositories/registration";
import { buildRepository } from "../support/builders";
import { useAppDb } from "../support/next";
import { manifest } from "../support/profiles";
import { seedSurvey } from "../support/scenarios";

/*
 * A Repository's current Profile as JSON (establish-frontend-registry, task
 * 10.7; the product-site scenario "A Profile for an agent").
 */

const get = (repositoryId: string) => GET(new Request(`https://registry.example/repositories/${repositoryId}/profile.json`), { params: Promise.resolve({ repositoryId }) });

describe("the JSON Profile", () => {
  const app = useAppDb();

  it("serves the current Profile's fact document as stored, with its digest", async () => {
    const web = buildRepository(app.db, { name: "web" });
    await seedSurvey(app.db, web, { files: { "package.json": manifest({ name: "web", version: "1.0.0", dependencies: { react: "19.3.1" } }) } });
    const latest = await seedSurvey(app.db, web, { files: { "package.json": manifest({ name: "web", version: "2.0.0", dependencies: { react: "19.3.1" } }) } });
    const document = profileDocument(currentProfile(app.db, web.id)!.profile);

    const response = await get(web.publicId);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body = await response.text();
    expect(body).toBe(dump(document.fact_document!));
    expect(response.headers.get("digest")).toBe(document.fact_document_digest);
    expect(sha256(body)).toBe(document.fact_document_digest);
    expect(response.headers.get("etag")).toBe(`"${String(document.fact_document_digest)}"`);
    expect(JSON.parse(body)).toMatchObject({ schema: "repo_facts.fact_document", schema_version: 3, commit: latest.commitSha });
  });

  it("answers not found for an unknown or deleted Repository, and for one with no Profile yet", async () => {
    expect((await get("src_0000000000000000")).status).toBe(404);
    expect(await (await get("not-an-id")).json()).toMatchObject({ error: "not_found" });
    const fresh = buildRepository(app.db, { name: "fresh" });
    const response = await get(fresh.publicId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "no_profile", message: "fresh has no Profile yet." });
    const gone = buildRepository(app.db, { name: "gone" });
    await seedSurvey(app.db, gone);
    deleteRepository(app.db, gone.publicId, "gone");
    expect(await (await get(gone.publicId)).json()).toMatchObject({ error: "not_found" });
  });
});
