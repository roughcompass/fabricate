import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { supersededBitbucketTokens } from "@/lib/admin/bitbucket-tokens";
import type { Db } from "@/lib/db/client";
import { createTestDb, migrateUpTo } from "../support/db";
import { migrationFolderAt } from "../support/migrations";

/*
 * Migration 0057 (use-saved-git-tokens, design decision 1, and the migration
 * plan): a server has one saved token, whoever owns it. Where a database
 * already holds several for one server, the newest stays and the others are
 * deleted, so the unique index can be built; the migration command lists
 * what it deleted, read with supersededBitbucketTokens before it migrates.
 */

const T0 = 1_795_000_000_000;
const BITBUCKET = "https://bitbucket.example.com/bitbucket";
const OTHER = "https://git.example.org";

describe("one Bitbucket token per server migration", () => {
  let db: Db;
  const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
  const tokens = () => db.$client.prepare("select public_id, name, server_url, token_hint from bitbucket_tokens order by id").all();
  const save = (id: number, name: string, serverUrl: string, createdAt: number) =>
    run("insert into bitbucket_tokens (id, public_id, name, server_url, token, token_hint, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)", id, `bbt_000000000000000${id}`, name, serverUrl, `BBDC-token-000${id}`, `000${id}`, createdAt, createdAt);

  beforeEach(() => {
    db = createTestDb(migrationFolderAt("0056_comments_and_shares_for_applications"));
  });
  afterEach(() => db.$client.close());

  it("keeps the newest token for a server, the larger id on a tie, and deletes the others, after naming them for the log", () => {
    save(1, "Platform team", BITBUCKET, T0);
    save(2, "Web team", BITBUCKET, T0 + 1_000);
    save(3, "Ops", BITBUCKET, T0 + 1_000);
    save(4, "Platform team", OTHER, T0);
    save(5, "Release team", BITBUCKET, T0 + 500);

    expect(supersededBitbucketTokens(db).map((token) => [token.name, token.serverUrl, token.tokenHint])).toEqual([
      ["Platform team", BITBUCKET, "0001"],
      ["Web team", BITBUCKET, "0002"],
      ["Release team", BITBUCKET, "0005"],
    ]);

    migrateUpTo(db, "0057_one_bitbucket_token_per_server");

    expect(tokens()).toEqual([
      { public_id: "bbt_0000000000000003", name: "Ops", server_url: BITBUCKET, token_hint: "0003" },
      { public_id: "bbt_0000000000000004", name: "Platform team", server_url: OTHER, token_hint: "0004" },
    ]);
    expect(supersededBitbucketTokens(db)).toEqual([]);
  });

  it("keeps every token when no server has two, and then refuses a second token for a server", () => {
    save(1, "Platform team", BITBUCKET, T0);
    save(2, "Platform team", OTHER, T0);
    expect(supersededBitbucketTokens(db)).toEqual([]);

    migrateUpTo(db, "0057_one_bitbucket_token_per_server");

    expect(tokens()).toHaveLength(2);
    expect(() => save(3, "Web team", BITBUCKET, T0 + 1_000)).toThrow(/UNIQUE constraint failed: bitbucket_tokens\.server_url/);
    expect(db.$client.prepare("select name from sqlite_master where type = 'index' and tbl_name = 'bitbucket_tokens' order by name").pluck().all()).toEqual(["bitbucket_tokens_public_id_unique", "bitbucket_tokens_server_url_unique"]);
  });

  it("finds nothing to delete in a database without the tokens table", () => {
    const empty = createTestDb(migrationFolderAt("0040_repository_deletion"));
    try {
      expect(supersededBitbucketTokens(empty)).toEqual([]);
    } finally {
      empty.$client.close();
    }
  });
});
