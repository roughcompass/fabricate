import { beforeEach, describe, expect, it } from "vitest";
import { addBitbucketToken, deleteBitbucketToken, findBitbucketToken, listBitbucketTokens, serverBaseUrl } from "@/lib/admin/bitbucket-tokens";
import type { Db } from "@/lib/db/client";
import { NotFoundError, ValidationError } from "@/lib/db/errors";
import { createTestDb, rawRun } from "../support/db";

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
      name: expect.stringMatching(/Enter the token's owner/),
      serverUrl: expect.stringMatching(/https/),
      token: expect.stringMatching(/no spaces/),
    });
    expect(issuesOf(() => addBitbucketToken(db, form({ token: "short" })))).toEqual({ token: expect.stringMatching(/between 8/) });
    expect(listBitbucketTokens(db)).toEqual([]);
  });

  it("keeps one token per server, whoever owns it, counting host case, a default port, and trailing slashes as the same server", () => {
    const saved = addBitbucketToken(db, form({ serverUrl: "https://bitbucket.example.com/bitbucket" }));
    for (const serverUrl of ["https://BITBUCKET.example.com:443/bitbucket/", "https://bitbucket.example.com/bitbucket//", "https://bitbucket.example.com:443/bitbucket"]) {
      expect(issuesOf(() => addBitbucketToken(db, form({ name: "Web team", serverUrl, token: "BBDC-another-token-0000" })))).toEqual({ serverUrl: "This server already has a token, saved for Platform team; delete it to save a new one" });
    }
    expect(issuesOf(() => addBitbucketToken(db, form({ token: "BBDC-another-token-0000" })))).toEqual({ serverUrl: expect.stringMatching(/already has a token/) });
    // The token already saved is unchanged.
    expect(listBitbucketTokens(db)).toEqual([saved]);
    expect(db.$client.prepare("select token from bitbucket_tokens").pluck().all()).toEqual([TOKEN]);

    // Another context path or another origin is another server.
    addBitbucketToken(db, form({ name: "Web team", serverUrl: "https://bitbucket.example.com/bitbucket-other" }));
    addBitbucketToken(db, form({ serverUrl: "https://bitbucket.example.com:8443/bitbucket" }));
    addBitbucketToken(db, form({ serverUrl: "https://git.example.org" }));
    expect(listBitbucketTokens(db).map((token) => token.serverUrl)).toEqual(["https://bitbucket.example.com/bitbucket", "https://bitbucket.example.com/bitbucket-other", "https://bitbucket.example.com:8443/bitbucket", "https://git.example.org"]);
  });

  it("holds the rule in the database: a second row for a server fails, whatever its owner", () => {
    addBitbucketToken(db, form());
    const insert = (publicId: string, name: string) => rawRun(db, "insert into bitbucket_tokens (public_id, name, server_url, token, token_hint, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)", publicId, name, "https://bitbucket.example.com/bitbucket", TOKEN, "bm9w", Date.now(), Date.now());
    expect(() => insert("bbt_0000000000000001", "Web team")).toThrow(/UNIQUE constraint failed: bitbucket_tokens\.server_url/);
    expect(() => insert("bbt_0000000000000002", "platform team")).toThrow(/UNIQUE constraint failed: bitbucket_tokens\.server_url/);
  });

  it("reports a save the unique index refuses on the server field too, as when another save lands first", () => {
    // A trigger saves another owner's token for the server just before this save's insert, after its own check found none.
    rawRun(db, `create temp trigger first_save before insert on main.bitbucket_tokens when new.name = 'Platform team' begin
      insert into bitbucket_tokens (public_id, name, server_url, token, token_hint, created_at, updated_at) values ('bbt_0000000000000001', 'Web team', new.server_url, 'BBDC-first-save-0000', '0000', new.created_at, new.updated_at);
    end`);
    expect(issuesOf(() => addBitbucketToken(db, form()))).toEqual({ serverUrl: "This server already has a token; delete it to save a new one" });
    expect(listBitbucketTokens(db)).toEqual([]);
  });

  it("frees a server for a new token once its token is deleted", () => {
    const first = addBitbucketToken(db, form());
    deleteBitbucketToken(db, first.publicId);
    const replacement = addBitbucketToken(db, form({ name: "Web team", serverUrl: "https://BITBUCKET.example.com:443/bitbucket", token: "BBDC-replacement-0001" }));
    expect(listBitbucketTokens(db)).toEqual([replacement]);
    expect(replacement).toMatchObject({ name: "Web team", serverUrl: "https://bitbucket.example.com/bitbucket", tokenHint: "0001" });
  });

  it("deletes a token for good, saying what it was", () => {
    const saved = addBitbucketToken(db, form());
    expect(deleteBitbucketToken(db, saved.publicId).name).toBe("Platform team");
    expect(db.$client.prepare("select count(*) from bitbucket_tokens").pluck().get()).toBe(0);
    expect(() => deleteBitbucketToken(db, saved.publicId)).toThrow(NotFoundError);
  });
});
