/*
 * The lines of an Add in bulk submission: one clone URL per line, optionally
 * followed by a branch, tag, or commit. No Node or database dependencies, so
 * the form states the same limit the server applies.
 */

/** The most lines one submission adds: the largest fleet DE FabLab plans for. */
export const BULK_LIMIT = 500;

export interface BulkLine {
  /** 1-based, counting blank lines, so it matches what was pasted. */
  readonly line: number;
  readonly text: string;
  readonly cloneUrl: string;
  readonly gitRef: string;
}

/** The non-blank lines of +input+: each one's clone URL, and its reference when one follows it. */
export function parseBulkLines(input: string): BulkLine[] {
  return input.split(/\r?\n/).flatMap((raw, index) => {
    const text = raw.trim();
    if (!text) return [];
    const [cloneUrl = "", gitRef = "", ...rest] = text.split(/\s+/);
    return [{ line: index + 1, text, cloneUrl, gitRef: rest.length ? `${gitRef} ${rest.join(" ")}` : gitRef }];
  });
}
