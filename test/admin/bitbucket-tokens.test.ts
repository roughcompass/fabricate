import { beforeEach, describe, expect, it } from "vitest";
import { addBitbucketToken, deleteBitbucketToken, findBitbucketToken, listBitbucketTokens, serverBaseUrl } from "@/lib/admin/bitbucket-tokens";
import type { Db } from "@/lib/db/client";
import { NotFoundError, ValidationError } from "@/lib/db/errors";
import { createTestDb } from "../support/db";

const TOKEN = "BBDC-NzA2MzQ1NjYxMjM0OkxhYmNkZWZnaGlqa2xtbm9w";
const form = (changes: Partial<{ name: string; serverUrl: string; token: string }> = {}) => ({ name: "Platform team", serverUrl: "https://bitbucket.example.com/bitbucket/", token: TOKEN, ...changes });
const issuesOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return Object.fromEntries(error.issues.map((issue) => [issue.field, issue.message]));
    throw error;
  }
  throw new Error("Expected a ValidationError");
};

describe("Bitbucket Server tokens", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("keeps a server's origin and context path, and refuses an address a token shouldn't be sent to", () => {
    expect(serverBaseUrl("https://bitbucket.example.com/bitbucket/")).toEqual({ url: "https://bitbucket.example.com/bitbucket" });
    expect(serverBaseUrl(" https://BITBUCKET.example.com ")).toEqual({ url: "https://bitbucket.example.com" });
    expect(serverBaseUrl("http://localhost:7990")).toEqual({ url: "http://localhost:7990" });
    expect(serverBaseUrl("http://bitbucket.example.com")).toHaveProperty("error", expect.stringMatching(/https/));
    expect(serverBaseUrl("https://user:secret@bitbucket.example.com")).toHaveProperty("error", expect.stringMatching(/credentials/));
    expect(serverBaseUrl("https://bitbucket.example.com/?token=x")).toHaveProperty("error", expect.stringMatching(/query/));
    expect(serverBaseUrl("bitbucket")).toHaveProperty("error");
  });

  it("saves a token and never hands it back: lists and lookups show its last four characters", () => {
    const saved = addBitbucketToken(db, form());
    expect(saved).toEqual({ publicId: expect.stringMatching(/^bbt_/), name: "Platform team", serverUrl: "https://bitbucket.example.com/bitbucket", tokenHint: "bm9w", createdAt: expect.any(Date) });
    for (const shown of [saved, ...listBitbucketTokens(db), findBitbucketToken(db, saved.publicId)]) expect(JSON.stringify(shown)).not.toContain(TOKEN);
    expect(db.$client.prepare("select token from bitbucket_tokens").pluck().get()).toBe(TOKEN);
  });

  it("reports every problem with a submission at once", () => {
    expect(issuesOf(() => addBitbucketToken(db, form({ name: " ", serverUrl: "ftp://bitbucket.example.com", token: "two words" })))).toEqual({
      name: expect.stringMatching(/Enter a name/),
      serverUrl: expect.stringMatching(/https/),
      token: expect.stringMatching(/no spaces/),
    });
    expect(issuesOf(() => addBitbucketToken(db, form({ token: "short" })))).toEqual({ token: expect.stringMatching(/between 8/) });
    expect(listBitbucketTokens(db)).toEqual([]);
  });

  it("keeps one token per name on a server, in any case, and allows the name on another server", () => {
    addBitbucketToken(db, form());
    expect(issuesOf(() => addBitbucketToken(db, form({ name: "PLATFORM TEAM", serverUrl: "https://bitbucket.example.com/bitbucket" })))).toEqual({ name: expect.stringMatching(/already saved for this server/) });
    addBitbucketToken(db, form({ serverUrl: "https://git.example.org" }));
    expect(listBitbucketTokens(db).map((token) => token.serverUrl)).toEqual(["https://bitbucket.example.com/bitbucket", "https://git.example.org"]);
  });

  it("deletes a token for good, saying what it was", () => {
    const saved = addBitbucketToken(db, form());
    expect(deleteBitbucketToken(db, saved.publicId).name).toBe("Platform team");
    expect(db.$client.prepare("select count(*) from bitbucket_tokens").pluck().get()).toBe(0);
    expect(() => deleteBitbucketToken(db, saved.publicId)).toThrow(NotFoundError);
  });
});
