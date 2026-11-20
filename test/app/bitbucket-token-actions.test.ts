import { describe, expect, it, vi } from "vitest";
import { addToken, deleteToken } from "@/app/(operator)/admin/bitbucket-tokens/actions";
import { listBitbucketTokens } from "@/lib/admin/bitbucket-tokens";
import { NotFoundError } from "@/lib/db/errors";
import { redirectOf, useAppDb, formData } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

const TOKEN = "BBDC-abcdefghijklmnopqrstuvwxyz0123456789";
const blank = { values: { name: "", serverUrl: "" }, errors: {} };

describe("Bitbucket token Server Actions", () => {
  const app = useAppDb();
  it("saves a token and opens the list with a notice naming it", async () => {
    const location = await redirectOf(addToken(blank, formData({ name: "Platform team", serverUrl: "https://bitbucket.example.com/", token: TOKEN })));

    const [saved] = listBitbucketTokens(app.db);
    expect(location).toBe(`/admin/bitbucket-tokens?notice=added&token=${saved!.publicId}`);
  });

  it("returns field errors that keep the name and server but never the token", async () => {
    const state = await addToken(blank, formData({ name: "Platform team", serverUrl: "ftp://bitbucket.example.com", token: `${TOKEN} extra` }));

    expect(state.values).toEqual({ name: "Platform team", serverUrl: "ftp://bitbucket.example.com" });
    expect(Object.keys(state.errors).sort()).toEqual(["serverUrl", "token"]);
    expect(JSON.stringify(state)).not.toContain(TOKEN);
    expect(listBitbucketTokens(app.db)).toEqual([]);
  });

  it("refuses another owner's token for a server that has one, on the server field, keeping the saved token", async () => {
    await redirectOf(addToken(blank, formData({ name: "Platform team", serverUrl: "https://bitbucket.example.com/bitbucket", token: TOKEN })));
    const state = await addToken(blank, formData({ name: "Web team", serverUrl: "https://BITBUCKET.example.com:443/bitbucket/", token: "BBDC-another-token-0000" }));

    expect(state.values).toEqual({ name: "Web team", serverUrl: "https://BITBUCKET.example.com:443/bitbucket/" });
    expect(state.errors).toEqual({ serverUrl: ["This server already has a token, saved for Platform team; delete it to save a new one"] });
    expect(JSON.stringify(state)).not.toContain("BBDC-another-token-0000");
    expect(listBitbucketTokens(app.db)).toEqual([expect.objectContaining({ name: "Platform team", tokenHint: TOKEN.slice(-4) })]);
  });

  it("deletes a token and names it in the notice", async () => {
    await redirectOf(addToken(blank, formData({ name: "Platform team", serverUrl: "https://bitbucket.example.com/", token: TOKEN })));
    const [saved] = listBitbucketTokens(app.db);

    expect(await redirectOf(deleteToken(formData({ publicId: saved!.publicId })))).toBe("/admin/bitbucket-tokens?notice=deleted&name=Platform%20team");
    expect(listBitbucketTokens(app.db)).toEqual([]);
  });

  it("refuses to delete with an address that names no token", async () => {
    await expect(deleteToken(formData({ publicId: "../../etc" }))).rejects.toThrow(NotFoundError);
    await expect(deleteToken(formData({ publicId: "src_0123456789abcdef" }))).rejects.toThrow(NotFoundError);
  });
});
