/**
 * The small Markdown subset comments may use (template-demo/toolbar spec;
 * toolbar-updates design.md, decision 8): `**bold**`, `*italic*`,
 * `~~strikethrough~~`, and `` `code` ``. A body is stored as written and
 * tokenized for display into text and styled runs, which the interface
 * renders as elements, never as HTML. Anything else, HTML included, stays
 * literal text.
 *
 * - Code spans are matched first, and their contents are literal.
 * - The other markers must be paired on one line, with no space just inside
 *   them, and can't open inside a code span. They may nest in one another.
 * - An unmatched marker stays literal.
 */

export type CommentStyle = "strong" | "em" | "s" | "code";

export type CommentNode = string | { readonly style: CommentStyle; readonly children: readonly CommentNode[] } | { readonly style: "break" };

/** Paired markers, longest first, so `**` is tried before `*`. */
const MARKERS: readonly (readonly [marker: string, style: Exclude<CommentStyle, "code">])[] = [
  ["**", "strong"],
  ["~~", "s"],
  ["*", "em"],
];

/** Where a code span that opens at `start` closes, or -1 when it doesn't, or is empty. */
function codeEnd(line: string, start: number): number {
  const end = line.indexOf("`", start + 1);
  return end > start + 1 ? end : -1;
}

/**
 * Where `marker` closes, searching from `from`: past code spans, and for `*`
 * past any `**`, which belongs to another pair. -1 when it doesn't close.
 */
function closing(line: string, marker: string, from: number): number {
  for (let index = from; index < line.length; index++) {
    if (line[index] === "`") {
      const end = codeEnd(line, index);
      if (end !== -1) {
        index = end;
        continue;
      }
    }
    if (marker === "*" && line.startsWith("**", index)) {
      index++;
      continue;
    }
    if (line.startsWith(marker, index)) return index;
  }
  return -1;
}

function parseLine(line: string): CommentNode[] {
  const nodes: CommentNode[] = [];
  let text = "";
  const flush = () => {
    if (text) nodes.push(text);
    text = "";
  };
  let index = 0;
  scan: while (index < line.length) {
    if (line[index] === "`") {
      const end = codeEnd(line, index);
      if (end !== -1) {
        flush();
        nodes.push({ style: "code", children: [line.slice(index + 1, end)] });
        index = end + 1;
        continue;
      }
    }
    for (const [marker, style] of MARKERS) {
      if (!line.startsWith(marker, index)) continue;
      const start = index + marker.length;
      const end = closing(line, marker, start);
      const inner = end === -1 ? "" : line.slice(start, end);
      if (inner && inner.trim() === inner) {
        flush();
        nodes.push({ style, children: parseLine(inner) });
        index = end + marker.length;
        continue scan;
      }
    }
    text += line[index];
    index++;
  }
  flush();
  return nodes;
}

/** A comment body as display runs, with a break between lines. */
export function formatComment(body: string): CommentNode[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line, index) => (index === 0 ? parseLine(line) : [{ style: "break" } as const, ...parseLine(line)]));
}

/** The body's text without its markers, for an accessible name or an excerpt. */
export function commentText(body: string): string {
  const text = (nodes: readonly CommentNode[]): string => nodes.map((node) => (typeof node === "string" ? node : node.style === "break" ? " " : text(node.children))).join("");
  return text(formatComment(body));
}

/** The markers the composer's formatting bar applies. */
export const FORMAT_MARKERS = { bold: "**", italic: "*", strikethrough: "~~", code: "`" } as const;

export interface TextSelection {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

/** How many `char` run from `index` in one direction: back from before it, or forward from it. */
function run(value: string, index: number, char: string, direction: -1 | 1): number {
  let count = 0;
  for (let at = direction === -1 ? index - 1 : index; at >= 0 && at < value.length && value[at] === char; at += direction) count++;
  return count;
}

/** Whether `marker` sits directly around [start, end): for `*`, a single or triple star, so bold's `**` isn't taken for italic. */
function wrapped(value: string, start: number, end: number, marker: string): boolean {
  if (marker === "*") {
    const [before, after] = [run(value, start, "*", -1), run(value, end, "*", 1)];
    return before % 2 === 1 && after % 2 === 1;
  }
  return start >= marker.length && value.slice(start - marker.length, start) === marker && value.slice(end, end + marker.length) === marker;
}

/**
 * Applies or removes a marker around the selected text, as the composer's
 * formatting buttons do: markers already around the selection, or just
 * inside it, come off; otherwise they wrap it. With nothing selected, a pair
 * goes in with the caret between. The selection stays on the same text.
 */
export function toggleMarker({ value, start, end }: TextSelection, marker: string): TextSelection {
  const m = marker.length;
  if (start !== end && wrapped(value, start, end, marker)) {
    return { value: value.slice(0, start - m) + value.slice(start, end) + value.slice(end + m), start: start - m, end: end - m };
  }
  const selected = value.slice(start, end);
  if (selected.length > 2 * m && selected.startsWith(marker) && selected.endsWith(marker) && (marker !== "*" || wrapped(selected, m, selected.length - m, marker))) {
    return { value: value.slice(0, start) + selected.slice(m, -m) + value.slice(end), start, end: end - 2 * m };
  }
  return { value: value.slice(0, start) + marker + selected + marker + value.slice(end), start: start + m, end: end + m };
}
