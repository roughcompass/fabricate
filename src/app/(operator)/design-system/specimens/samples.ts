/** Fixed sample values the specimens show, so the gallery renders the same way each time. */
export const DIGEST = "4807ba9e52ea3f1c9d0b7a6e5f4c3b2a1908f7e6d5c4b3a291807f6e5d4c3b2a";
export const HOUR = 3_600_000;

/** A sample time relative to the request, for the relative-time specimens. */
export function ago(milliseconds: number): Date {
  return new Date(Date.now() - milliseconds);
}

