import type { JsonObject } from "@repo-facts/contract";

/** A JSON pointer as a reader writes it: `~1` is a slash and `~0` a tilde (RFC 6901), so `/dependencies/@scope~1name` reads `/dependencies/@scope/name`. */
function readablePointer(pointer: string): string {
  return pointer.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** Where an evidence record points: a line range, a structured-data pointer, or a tree entry. */
export function evidenceLocation(record: JsonObject): string {
  const location = (record.location ?? {}) as JsonObject;
  const path = String(record.path ?? "");
  if (location.kind === "lines") {
    const start = Number(location.start);
    const end = Number(location.end ?? start);
    return `${path}:${start}${end !== start ? `–${end}` : ""}`;
  }
  if (location.kind === "pointer") return `${path} ${readablePointer(String(location.pointer))}`;
  return path;
}

/** An evidence record's id and where it points, for a link to it. */
export interface EvidenceLocation {
  id: string;
  location: string;
}

/** Code-unit order, the same in every locale. */
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Where a record points, as a sort key: its path, then the entry itself before pointers before lines, then its lines or pointer. */
function placeOf(record: JsonObject | undefined): [path: string, kind: number, start: number, end: number, pointer: string] {
  const location = (record?.location ?? {}) as JsonObject;
  const path = String(record?.path ?? "");
  if (location.kind === "lines") return [path, 2, Number(location.start), Number(location.end ?? location.start), ""];
  if (location.kind === "pointer") return [path, 1, 0, 0, String(location.pointer)];
  return [path, 0, 0, 0, ""];
}

/**
 * Evidence IDs in the order their locations read: by path, then line, then
 * ID. A Profile stores a fact's evidence in the order its detectors cited it,
 * which can differ from one survey to the next, so every list sorts at
 * display, and the same survey always lists its locations the same way.
 */
export function sortedEvidence(ids: readonly unknown[], records: JsonObject): string[] {
  return ids
    .map(String)
    .map((id) => ({ id, place: placeOf(records[id] as JsonObject | undefined) }))
    .sort((a, b) => byCodeUnits(a.place[0], b.place[0]) || a.place[1] - b.place[1] || a.place[2] - b.place[2] || a.place[3] - b.place[3] || byCodeUnits(a.place[4], b.place[4]) || byCodeUnits(a.id, b.id))
    .map(({ id }) => id);
}

/** The locations of the cited records that exist, by path, then line. */
export function evidenceLocations(ids: readonly unknown[], records: JsonObject): EvidenceLocation[] {
  return sortedEvidence(ids, records).flatMap((id) => (records[id] ? [{ id, location: evidenceLocation(records[id] as JsonObject) }] : []));
}
