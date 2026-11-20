import crypto from "node:crypto";

/**
 * The digest stored for an anonymous workspace credential (design.md, decision
 * 3). Workspaces are keyed by it. This module imports no
 * database code.
 */
export function keyDigest(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}
