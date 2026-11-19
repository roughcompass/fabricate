import type { JsonObject, JsonValue } from "@repo-facts/contract";
import Link from "next/link";
import { type EvidenceLocation, evidenceLocations } from "@/lib/profiles/evidence-locations";
import styles from "./results.module.css";
import { type EvidenceOwner, routes } from "@/lib/web/routes";

/**
 * The evidence behind a fact, relationship, or Finding: each record's
 * committed location, linked to a view of the cited lines, with its detector
 * and rule unless +source+ is false, as on a Profile, whose category headings name the rule once.
 */
export function EvidenceList({ ids, records, owner, source = true }: { ids: readonly JsonValue[]; records: JsonObject; owner: EvidenceOwner; source?: boolean }) {
  const locations = evidenceLocations(ids, records);
  return (
    <LocationList
      locations={locations}
      owner={owner}
      detail={source ? (location) => `${String((records[location.id] as JsonObject).detector)} · ${String((records[location.id] as JsonObject).rule)}` : undefined}
    />
  );
}

/** Evidence locations, each linked to its record, with an optional detail line. */
export function LocationList({ locations, owner, detail }: { locations: readonly EvidenceLocation[]; owner: EvidenceOwner; detail?: (location: EvidenceLocation) => string }) {
  if (!locations.length) return <span className={styles.muted}>No evidence</span>;
  return (
    <ul className={styles.evidence}>
      {locations.map((location) => (
        <li key={location.id}>
          <Link href={routes.evidence(owner, location.id)} className={styles.location}>
            {location.location}
          </Link>
          {detail && <span className={styles.source}>{detail(location)}</span>}
        </li>
      ))}
    </ul>
  );
}
