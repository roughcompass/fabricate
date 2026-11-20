import { sql } from "drizzle-orm";
import { check, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, id, publicId, updatedAt } from "./columns";

/**
 * A Bitbucket Server access token an operator saved under Admin, one per
 * server: Git sends it to the HTTPS remotes under its server
 * (use-saved-git-tokens). `name` holds its owner, a person or a team, which
 * only labels it. The token itself is read only where Git uses it; every
 * page sees its last four characters, `token_hint`.
 * It's stored as given, as the rest of this proof of concept stores its
 * settings, so the database file is as sensitive as the token.
 */
export const bitbucketTokens = sqliteTable(
  "bitbucket_tokens",
  {
    id: id(),
    publicId: publicId(),
    name: text("name").notNull(),
    /** The server's base address: its origin and any context path, without a trailing slash. */
    serverUrl: text("server_url").notNull(),
    token: text("token").notNull(),
    tokenHint: text("token_hint").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("bitbucket_tokens_server_url_unique").on(t.serverUrl),
    check("bitbucket_tokens_public_id", sql`${t.publicId} GLOB 'bbt_*'`),
    check("bitbucket_tokens_name", sql`length(trim(${t.name})) BETWEEN 1 AND 100`),
    check("bitbucket_tokens_server_url", sql`${t.serverUrl} GLOB 'http*://*'`),
    check("bitbucket_tokens_token", sql`length(${t.token}) BETWEEN 8 AND 4096`),
    check("bitbucket_tokens_token_hint", sql`length(${t.tokenHint}) = 4`),
  ],
);
