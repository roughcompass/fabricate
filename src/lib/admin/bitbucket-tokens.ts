import { and, asc, eq, exists, gt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError, ValidationError, isUniqueViolation } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { bitbucketTokens } from "@/lib/db/schema";
import { CloneUrl, InvalidCloneUrl } from "@/lib/repositories/clone-url";

/**
 * Bitbucket Server access tokens an operator saves under Admin, one per
 * server. A saved token leaves this module only through bitbucketTokenFor,
 * for Git to send to its server; lists and pages get a summary with its
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
/**
 * A path segment Git, a proxy, and Bitbucket all read as it's written: RFC
 * 3986 path characters, without %-escapes, which a server decodes before it
 * matches a context path, or the ";" that starts a path parameter, which a
 * servlet container drops.
 */
const PLAIN_SEGMENT = /^[A-Za-z0-9._~!$&'()*+,=:@-]+$/;

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

/**
 * The saved token Git sends to +gitUrl+, a canonical https:// clone URL as
 * GitRunner hands it to Git, and nothing else about it: the token of the
 * server whose origin, port included, is the URL's, and whose context path
 * is the URL's path or contains it at a slash, the longest such path when
 * several match. Null for any other URL: another transport, another origin,
 * a path outside every context path, or a path, the URL's or a saved
 * server's on its origin, whose encoding could make Bitbucket match it
 * differently than it's compared here. Read at each call, so a save or a
 * deletion applies to the next Git command.
 */
export function bitbucketTokenFor(db: Executor, gitUrl: string): string | null {
  const remote = httpsRemote(gitUrl);
  if (!remote) return null;
  let selected: { id: number; path: string } | null = null;
  for (const server of db.select({ id: bitbucketTokens.id, serverUrl: bitbucketTokens.serverUrl }).from(bitbucketTokens).all()) {
    const base = new URL(server.serverUrl);
    if (base.origin !== remote.origin) continue;
    const path = base.pathname.replace(/\/+$/, "");
    if (!isPlainPath(path)) return null;
    if (remote.path !== path && !remote.path.startsWith(`${path}/`)) continue;
    if (!selected || path.length > selected.path.length) selected = { id: server.id, path };
  }
  return selected && (tokenById(db, selected.id) ?? null);
}

function tokenById(db: Executor, id: number): string | undefined {
  return db.select({ token: bitbucketTokens.token }).from(bitbucketTokens).where(eq(bitbucketTokens.id, id)).get()?.token;
}

/** The origin and decoded path of a canonical https:// clone URL whose path is plain, or null. */
function httpsRemote(gitUrl: string): { origin: string; path: string } | null {
  let url: CloneUrl;
  try {
    url = CloneUrl.parse(gitUrl);
  } catch (error) {
    if (error instanceof InvalidCloneUrl) return null;
    throw error;
  }
  if (url.protocol !== "https" || url.toString() !== gitUrl || !isPlainPath(url.path)) return null;
  return { origin: new URL(gitUrl).origin, path: url.path };
}

/** Whether +path+, empty or a slash before each segment, has only plain segments, so it reads the same encoded or decoded. */
function isPlainPath(path: string): boolean {
  return path === "" || path.slice(1).split("/").every((segment) => PLAIN_SEGMENT.test(segment) && segment !== "." && segment !== "..");
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
