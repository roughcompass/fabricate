import crypto from "node:crypto";
import { NotFoundError } from "./errors";

/**
 * Stable, prefixed public identifiers used in URLs, documents, and Git refs.
 * Database row ids never leave the data-access layer.
 */
export type PublicIdPrefix =
  | "src" // repository source
  | "ini" // initiative
  | "asm" // assessment
  | "tgt" // assessment target
  | "srv" // survey
  | "prf" // repository profile
  | "map" // relationship map
  | "std" // standard
  | "rel" // standard release
  | "evl" // evaluation
  | "fnd" // finding
  | "thr" // comment thread
  | "cmt" // comment
  | "dpf" // the template demo's session profile, dropped by migration 0056
  | "bbt" // Bitbucket token
  | "ppr" // preview preparation
  | "pvw" // preview build
  | "app" // application
  | "apv" // saved preview of an application
  | "ses"; // session preset

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const LENGTH = 16;

export function generatePublicId(prefix: PublicIdPrefix): string {
  let suffix = "";
  for (let index = 0; index < LENGTH; index++) suffix += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${prefix}_${suffix}`;
}

export function isPublicId(value: unknown, prefix?: PublicIdPrefix): value is string {
  return typeof value === "string" && /^[a-z]{3}_[a-z0-9]{16}$/.test(value) && (prefix === undefined || value.startsWith(`${prefix}_`));
}

/** +value+ as a public ID with +prefix+, or a NotFoundError naming +what+, so a crafted address finds nothing. */
export function requirePublicId(value: string, prefix: PublicIdPrefix, what: string): string {
  if (!isPublicId(value, prefix)) throw new NotFoundError(`Unknown ${what}`);
  return value;
}
