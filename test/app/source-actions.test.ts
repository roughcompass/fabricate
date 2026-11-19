import { describe, expect, it, vi } from "vitest";
import { createSource, deleteRepository, reprofileSource, updateSource } from "@/app/(operator)/repositories/actions";
import { sourceOutcome } from "@/app/(operator)/repositories/outcomes";
import { findSource, getSource, insertSource, listSources } from "@/lib/catalog/source-records";
import { redirectOf, useAppDb, formData } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

const blank = { values: { name: "", cloneUrl: "", gitRef: "" }, errors: {} };

describe("source Server Actions", () => {
  const app = useAppDb();

  it("creates a source and redirects to the catalog with a notice", async () => {
    const location = await redirectOf(createSource(blank, formData({ name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", gitRef: "main" })));

    const [source] = listSources(app.db);
    expect(location).toBe(`/repositories?notice=added&source=${source!.publicId}`);
  });

  it("returns field errors without persisting or echoing a secret", async () => {
    const state = await createSource(blank, formData({ name: "", cloneUrl: "https://user:hunter2@git.example.com/acme/app.git", gitRef: "" }));

    // A blank name follows the clone URL, so only the URL is refused.
    expect(state.errors.name).toBeUndefined();
    expect(state.errors.cloneUrl?.[0]).toMatch(/cannot contain a username, password, or access token/);
    expect(JSON.stringify(state)).not.toContain("hunter2");
    expect(listSources(app.db)).toEqual([]);
  });

  it("returns the duplicate source's identity", async () => {
    const existing = insertSource(app.db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders" });
    const state = await createSource(blank, formData({ name: "copy", cloneUrl: "https://GIT.EXAMPLE.COM/acme/orders", gitRef: "" }));

    expect(state.errors.cloneUrl).toEqual([`This clone URL is already registered as orders (${existing.publicId})`]);
  });

  it("updates a source and reports a stale edit", async () => {
    const source = insertSource(app.db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders" });
    const fields = { name: "orders-ui", cloneUrl: source.cloneUrl, gitRef: "", lockVersion: 0 };

    expect(await redirectOf(updateSource(source.publicId, blank, formData(fields)))).toBe(`/repositories/${source.publicId}/settings?notice=updated`);
    const stale = await updateSource(source.publicId, blank, formData({ ...fields, name: "stale" }));
    expect(stale.errors.base?.[0]).toMatch(/changed by someone else/);
    expect(getSource(app.db, source.publicId).name).toBe("orders-ui");
  });

  it("deletes a source only when its name is typed, then returns to the catalog", async () => {
    const source = insertSource(app.db, { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders" });

    expect(await deleteRepository(source.publicId, { error: null }, formData({ confirmation: "order" }))).toEqual({ error: "Type orders to confirm" });
    expect(findSource(app.db, source.publicId)).toBeDefined();
    expect(await redirectOf(deleteRepository(source.publicId, { error: null }, formData({ confirmation: "orders" })))).toBe(`/repositories?notice=deleted&source=${source.publicId}`);
    expect(findSource(app.db, source.publicId)).toBeUndefined();
    expect(sourceOutcome(app.db, "deleted", source.publicId)).toMatchObject({ title: "orders was deleted." });
    expect(sourceOutcome(app.db, "updated", source.publicId)).toBeUndefined();
    await expect(deleteRepository("../../etc", { error: null }, formData({ confirmation: "orders" }))).rejects.toThrow(/Unknown repository source/);
  });

  it("rejects a malformed source id when re-profiling", async () => {
    await expect(reprofileSource(formData({ publicId: "../../etc" }))).rejects.toThrow(/Unknown repository source/);
  });

});
