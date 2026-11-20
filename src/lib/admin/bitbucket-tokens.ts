import { and, asc, eq, exists, gt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError, ValidationError, isUniqueViolation } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { bitbucketTokens } from "@/lib/db/schema";

/**
 * Bitbucket Server access tokens an operator saves under Admin. A saved
 * token never leaves this module: lists and pages get a summary with its
 * last four characters, so it can't be shown, logged, or sent back to a
 * browser by mistake.
 */

/** A saved token as pages may show it. */
export interface BitbucketTokenSummary {
  publicId: string;
  /** The token's owner, a person or a team. */
  name: string;
  serverUrl: string;
  /** The token's last four characters, so an operator can tell tokens apart. */
  tokenHint: string;
  createdAt: Date;
}

export interface BitbucketTokenForm {
  name: string;
  serverUrl: string;
  token: string;
}

const NAME_LIMIT = 100;
const TOKEN_MIN = 8;
const TOKEN_LIMIT = 4_096;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const summary = {
  publicId: bitbucketTokens.publicId,
  name: bitbucketTokens.name,
  serverUrl: bitbucketTokens.serverUrl,
  tokenHint: bitbucketTokens.tokenHint,
  createdAt: bitbucketTokens.createdAt,
};

/**
 * A Bitbucket Server's base address as it's stored: its origin and any
 * context path, such as https://bitbucket.example.com/bitbucket, without a
 * trailing slash. A token travels to it, so it must use HTTPS, except on
 * this machine, and can't carry credentials, a query, or a fragment.
 */
export function serverBaseUrl(value: string): { url: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return { error: "Enter the server's address, such as https://bitbucket.example.com" };
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname))) return { error: "The server must use https://, so the token isn't sent in the clear" };
  if (parsed.username || parsed.password) return { error: "Leave credentials out of the address; the token is entered below" };
  if (parsed.search || parsed.hash) return { error: "Enter only the server's address, without a query or fragment" };
  return { url: `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}` };
}

export function listBitbucketTokens(db: Executor): BitbucketTokenSummary[] {
  return db.select(summary).from(bitbucketTokens).orderBy(asc(bitbucketTokens.serverUrl), sql`lower(${bitbucketTokens.name})`, asc(bitbucketTokens.publicId)).all();
}

export function findBitbucketToken(db: Executor, publicId: string): BitbucketTokenSummary | undefined {
  return db.select(summary).from(bitbucketTokens).where(eq(bitbucketTokens.publicId, publicId)).get();
}

/** Saves a token after checking every field, reporting each problem; a server has one token, whoever owns it. */
export function addBitbucketToken(db: Executor, form: BitbucketTokenForm): BitbucketTokenSummary {
  return immediate(db, (tx) => {
    const issues = new IssueCollector();
    const name = form.name.trim();
    const token = form.token.trim();
    if (!name) issues.add("name", "Enter the token's owner, such as a person or a team");
    else if (name.length > NAME_LIMIT) issues.add("name", `Use at most ${NAME_LIMIT} characters`);
    const server = serverBaseUrl(form.serverUrl);
    if ("error" in server) issues.add("serverUrl", server.error);
    if (!token) issues.add("token", "Paste the token");
    else if (/\s/.test(token)) issues.add("token", "A token has no spaces or line breaks");
    else if (token.length < TOKEN_MIN || token.length > TOKEN_LIMIT) issues.add("token", `A token has between ${TOKEN_MIN} and ${TOKEN_LIMIT} characters`);
    issues.throwIfAny();

    const serverUrl = (server as { url: string }).url;
    const taken = tx.select({ name: bitbucketTokens.name }).from(bitbucketTokens).where(eq(bitbucketTokens.serverUrl, serverUrl)).get();
    if (taken) throw serverTaken(taken.name);

    const now = new Date();
    try {
      return tx.insert(bitbucketTokens).values({ publicId: generatePublicId("bbt"), name, serverUrl, token, tokenHint: token.slice(-4), createdAt: now, updatedAt: now }).returning(summary).get();
    } catch (error) {
      // The unique index holds the rule for a save the check above didn't see.
      if (isUniqueViolation(error)) throw serverTaken();
      throw error;
    }
  });
}

/** The error a save gets for a server that has a token: deleting that one frees the server for a replacement. */
function serverTaken(owner?: string): ValidationError {
  return new ValidationError([{ field: "serverUrl", message: `This server already has a token${owner ? `, saved for ${owner}` : ""}; delete it to save a new one` }]);
}

/**
 * Tokens a newer token for the same server supersedes: every token but the
 * newest for its server, saved last or, on a tie, with the larger id. They
 * can exist only before migration 0057, which deletes them, so the migration
 * command reads them first to list what it deleted. Empty before the table
 * exists.
 */
export function supersededBitbucketTokens(db: Executor): BitbucketTokenSummary[] {
  const table = db.get<{ found: number }>(sql`select count(*) as found from sqlite_master where type = 'table' and name = 'bitbucket_tokens'`);
  if (!table?.found) return [];
  const newer = alias(bitbucketTokens, "newer");
  const supersedes = or(gt(newer.createdAt, bitbucketTokens.createdAt), and(eq(newer.createdAt, bitbucketTokens.createdAt), gt(newer.id, bitbucketTokens.id)));
  return db
    .select(summary)
    .from(bitbucketTokens)
    .where(exists(db.select({ id: newer.id }).from(newer).where(and(eq(newer.serverUrl, bitbucketTokens.serverUrl), supersedes))))
    .orderBy(asc(bitbucketTokens.serverUrl), asc(bitbucketTokens.id))
    .all();
}

/** Removes a saved token for good, returning what it was so the page can say so. */
export function deleteBitbucketToken(db: Executor, publicId: string): BitbucketTokenSummary {
  return immediate(db, (tx) => {
    const token = findBitbucketToken(tx, publicId);
    if (!token) throw new NotFoundError(`Bitbucket token ${publicId} does not exist`);
    tx.delete(bitbucketTokens).where(eq(bitbucketTokens.publicId, publicId)).run();
    return token;
  });
}
