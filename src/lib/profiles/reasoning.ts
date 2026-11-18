/**
 * Why an inferred fact holds, as a statement and the examples it rests on.
 * Detectors write a reasoning as one sentence that ends in a list, such as
 * "…could apply instead: display: flex (src/a.tsx:43); gap: 8px (src/b.tsx:61);
 * and 5 more." Read as data, the statement can stand alone in a table and the
 * list can be laid out one example per line, each with its location.
 */
export interface Reasoning {
  /** The statement before the list, as a sentence. */
  lead: string;
  items: { text: string; location: string | null }[];
  /** Examples the detector left out after its last one. */
  more: number;
}

// A template literal's `${…}` reaches the stylesheet parser as a run of underscores; it reads as the code wrote it.
const interpolated = (text: string) => text.replace(/_{3,}/g, "${…}");

/** Splits +text+ on "; " outside parentheses, so a location such as "(a.ts:1; b.ts:2)" stays whole. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && char === ";" && text[index + 1] === " ") {
      parts.push(text.slice(start, index));
      start = index + 2;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** One example: its text, and the location in its trailing parentheses when it has one. */
function item(text: string): Reasoning["items"][number] {
  if (!text.endsWith(")")) return { text: interpolated(text), location: null };
  let depth = 0;
  for (let index = text.length - 1; index >= 0; index--) {
    if (text[index] === ")") depth++;
    else if (text[index] === "(" && --depth === 0) {
      const location = text.slice(index + 1, -1);
      // Only a path with a line, such as "src/a.ts:12", is a location; "(calc)" is part of a value.
      return /[\w.-]+\/?[\w./-]*:\d+/.test(location) && index > 0 ? { text: interpolated(text.slice(0, index).trim()), location } : { text: interpolated(text), location: null };
    }
  }
  return { text: interpolated(text), location: null };
}

/** The statement and its examples, or null for a reasoning that isn't a statement followed by a list of two or more. */
export function parseReasoning(text: string): Reasoning | null {
  const colon = text.indexOf(": ");
  if (colon === -1) return null;
  const parts = splitTopLevel(text.slice(colon + 2).replace(/\.\s*$/, ""));
  let more = 0;
  const last = parts.at(-1);
  const rest = last && /^and (\d+) more$/.exec(last);
  if (rest) {
    more = Number(rest[1]);
    parts.pop();
  }
  if (parts.length + (more ? 1 : 0) < 2) return null;
  return { lead: `${text.slice(0, colon).trim()}.`, items: parts.map(item), more };
}

/** A reasoning's statement without its examples, or its first sentence when it has none. */
export function reasoningLead(text: string): string {
  const parsed = parseReasoning(text);
  if (parsed) return parsed.lead;
  const end = text.search(/\.\s/);
  return end === -1 ? text : text.slice(0, end + 1);
}
