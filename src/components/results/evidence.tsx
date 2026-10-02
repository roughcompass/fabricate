import type { JsonObject, JsonValue } from "@repo-facts/contract";
import Link from "next/link";
import styles from "./results.module.css";

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

/**
 * The evidence behind a fact, relationship, or Finding: each record's
 * committed location, linked to a view of the cited lines, with its detector
 * and rule unless +source+ is false, as on a Profile, whose category headings name the rule once.
 */
export function EvidenceList({ ids, records, assessmentId, source = true }: { ids: readonly JsonValue[]; records: JsonObject; assessmentId: string; source?: boolean }) {
  const cited = ids.map(String).filter((id) => records[id]);
  if (!cited.length) return <span className={styles.muted}>No evidence</span>;
  return (
    <ul className={styles.evidence}>
      {cited.map((id) => {
        const record = records[id] as JsonObject;
        return (
          <li key={id}>
            <Link href={`/runs/${assessmentId}/evidence/${id}`} className={styles.location}>
              {evidenceLocation(record)}
            </Link>
            {source && (
              <span className={styles.source}>
                {String(record.detector)} · {String(record.rule)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
