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

/** The locations of the cited records that exist, in citation order. */
export function evidenceLocations(ids: readonly unknown[], records: JsonObject): EvidenceLocation[] {
  return ids.map(String).flatMap((id) => (records[id] ? [{ id, location: evidenceLocation(records[id] as JsonObject) }] : []));
}
