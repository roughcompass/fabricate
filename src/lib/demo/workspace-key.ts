/**
 * The anonymous workspace credential (design.md, decision 3). The browser holds
 * a random 256-bit key in an httpOnly cookie; the server stores only its
 * SHA-256 digest. This module has no Node dependencies so the request proxy can
 * use it.
 */

export const WORKSPACE_COOKIE = "fabricate_demo_workspace";

/** Long enough that a visitor's workspace survives between visits (browsers cap cookies at 400 days). */
export const WORKSPACE_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newWorkspaceKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export function isWorkspaceKey(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
