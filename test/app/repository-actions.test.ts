import { describe, expect, it, vi } from "vitest";
import { createRepository, deleteRepository, reprofileRepository, updateRepository } from "@/app/(operator)/repositories/actions";
import { repositoryOutcome } from "@/app/(operator)/repositories/outcomes";
import { findRepository, getRepository, insertRepository, listRepositories } from "@/lib/repositories/repository-records";
import { redirectOf, useAppDb, formData } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

const blank = { values: { name: "", cloneUrl: "", gitRef: "" }, errors: {} };

describe("source Server Actions", () => {
  const app = useAppDb();

  it("creates a source and redirects to the catalog with a notice", async () => {
    const location = await redirectOf(createRepository(blank, formData({ name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "main" })));

    const [repository] = listRepositories(app.db);
    expect(location).toBe(`/repositories?notice=added&source=${repository!.publicId}`);
  });

  it("returns field errors without persisting or echoing a secret", async () => {
    const state = await createRepository(blank, formData({ name: "", cloneUrl: "https://user:hunter2@git.example.com/acme/app.git", gitRef: "" }));

    // A blank name follows the clone URL, so only the URL is refused.
    expect(state.errors.name).toBeUndefined();
    expect(state.errors.cloneUrl?.[0]).toMatch(/cannot contain a username, password, or access token/);
    expect(JSON.stringify(state)).not.toContain("hunter2");
    expect(listRepositories(app.db)).toEqual([]);
  });

  it("returns the duplicate source's identity", async () => {
    const existing = insertRepository(app.db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders" });
    const state = await createRepository(blank, formData({ name: "copy", cloneUrl: "https://GIT.EXAMPLE.COM/acme/orders", gitRef: "" }));

    expect(state.errors.cloneUrl).toEqual([`This clone URL is already registered as orders (${existing.publicId})`]);
  });

  it("updates a source and reports a stale edit", async () => {
    const repository = insertRepository(app.db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders" });
    const fields = { name: "orders-ui", cloneUrl: repository.cloneUrl, gitRef: "", lockVersion: 0 };

    expect(await redirectOf(updateRepository(repository.publicId, blank, formData(fields)))).toBe(`/repositories/${repository.publicId}/settings?notice=updated`);
    const stale = await updateRepository(repository.publicId, blank, formData({ ...fields, name: "stale" }));
    expect(stale.errors.base?.[0]).toMatch(/changed by someone else/);
    expect(getRepository(app.db, repository.publicId).name).toBe("orders-ui");
  });

  it("deletes a source only when its name is typed, then returns to the catalog", async () => {
    const repository = insertRepository(app.db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders" });

    expect(await deleteRepository(repository.publicId, { error: null }, formData({ confirmation: "order" }))).toEqual({ error: "Type orders to confirm" });
    expect(findRepository(app.db, repository.publicId)).toBeDefined();
    expect(await redirectOf(deleteRepository(repository.publicId, { error: null }, formData({ confirmation: "orders" })))).toBe(`/repositories?notice=deleted&source=${repository.publicId}`);
    expect(findRepository(app.db, repository.publicId)).toBeUndefined();
    expect(repositoryOutcome(app.db, "deleted", repository.publicId)).toMatchObject({ title: "orders was deleted." });
    expect(repositoryOutcome(app.db, "updated", repository.publicId)).toBeUndefined();
    await expect(deleteRepository("../../etc", { error: null }, formData({ confirmation: "orders" }))).rejects.toThrow(/Unknown Repository/);
  });

  it("rejects a malformed source id when re-profiling", async () => {
    await expect(reprofileRepository(formData({ publicId: "../../etc" }))).rejects.toThrow(/Unknown Repository/);
  });

});
