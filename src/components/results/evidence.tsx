import type { JsonObject, JsonValue } from "@repo-facts/contract";
import Link from "next/link";
import styles from "./results.module.css";

/** Where an evidence record points: a line range, a structured-data pointer, or a tree entry. */
export function evidenceLocation(record: JsonObject): string {
  const location = (record.location ?? {}) as JsonObject;
  const path = String(record.path ?? "");
  if (location.kind === "lines") {
    const start = Number(location.start);
    const end = Number(location.end ?? start);
    return `${path}:${start}${end !== start ? `–${end}` : ""}`;
  }
  if (location.kind === "pointer") return `${path} ${String(location.pointer)}`;
  return path;
}

/**
 * The evidence behind a fact, relationship, or Finding: each record's
 * committed location, detector, and rule, linked to a view of the cited lines.
 */
export function EvidenceList({ ids, records, assessmentId }: { ids: readonly JsonValue[]; records: JsonObject; assessmentId: string }) {
  const cited = ids.map(String).filter((id) => records[id]);
  if (!cited.length) return <span className={styles.muted}>No evidence</span>;
  return (
    <ul className={styles.evidence}>
      {cited.map((id) => {
        const record = records[id] as JsonObject;
        return (
          <li key={id}>
            <Link href={`/assessments/${assessmentId}/evidence/${id}`} className={styles.evidenceLink}>
              {evidenceLocation(record)}
            </Link>{" "}
            <span className={styles.muted}>
              {String(record.detector)} · {String(record.rule)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
