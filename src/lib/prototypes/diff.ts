/**
 * Line differences between two versions' files (versions spec, "Two versions
 * can be compared side by side": Code changes). A longest-common-subsequence
 * diff over lines, grouped into hunks with a few lines of context, as a
 * reviewer reads them.
 */

export interface DiffLine {
  readonly kind: "same" | "added" | "removed";
  readonly text: string;
  /** The line's number in the first file, for same and removed lines. */
  readonly before: number | null;
  /** The line's number in the second file, for same and added lines. */
  readonly after: number | null;
}

export interface FileDiff {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly hunks: readonly (readonly DiffLine[])[];
  /** Set when the files are too long to compare line by line. */
  readonly tooLarge?: boolean;
}

const CONTEXT = 3;
/** Generated files are a few hundred lines; beyond this many cells the table would be too big to build per request. */
const MAX_CELLS = 4_000_000;

function lines(text: string): string[] {
  const all = text.split("\n");
  if (all.at(-1) === "") all.pop();
  return all;
}

/** Every line of the two texts, in order, marked same, added, or removed. */
export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = lines(before);
  const b = lines(after);
  if (a.length * b.length > MAX_CELLS) return null;
  const width = b.length + 1;
  // lengths[i * width + j]: the longest common subsequence of a[i..] and b[j..].
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] = a[i] === b[j] ? lengths[(i + 1) * width + j + 1]! + 1 : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      result.push({ kind: "same", text: a[i]!, before: i + 1, after: j + 1 });
      i++;
      j++;
    } else if (i < a.length && (j === b.length || lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)) {
      // Removals come before additions, as reviewers expect.
      result.push({ kind: "removed", text: a[i]!, before: i + 1, after: null });
      i++;
    } else {
      result.push({ kind: "added", text: b[j]!, before: null, after: j + 1 });
      j++;
    }
  }
  return result;
}

/** The changes in one file, as hunks of changed lines with their context. Identical files have no hunks. */
export function diffFile(path: string, before: string, after: string): FileDiff {
  const all = diffLines(before, after);
  if (!all) return { path, added: 0, removed: 0, hunks: [], tooLarge: true };
  const changed = all.flatMap((line, index) => (line.kind === "same" ? [] : [index]));
  const hunks: DiffLine[][] = [];
  let start = -1;
  let end = -1;
  for (const index of changed) {
    if (start >= 0 && index - CONTEXT <= end + 1) {
      end = Math.min(all.length - 1, index + CONTEXT);
      continue;
    }
    if (start >= 0) hunks.push(all.slice(start, end + 1));
    start = Math.max(0, index - CONTEXT);
    end = Math.min(all.length - 1, index + CONTEXT);
  }
  if (start >= 0) hunks.push(all.slice(start, end + 1));
  return { path, added: all.filter((line) => line.kind === "added").length, removed: all.filter((line) => line.kind === "removed").length, hunks };
}
