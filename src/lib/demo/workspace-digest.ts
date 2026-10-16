import crypto from "node:crypto";

/**
 * The digest stored for an anonymous workspace credential (design.md, decision
 * 3). The template demo and Prototypes both key their workspaces by it, so a
 * browser has one identity in both. This module imports no database code, so
 * Prototypes can use it in the hosted profile, where SQLite never loads.
 */
export function keyDigest(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}
