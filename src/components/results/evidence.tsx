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
export function EvidenceList({ ids, records, owner, source = true, of }: { ids: readonly JsonValue[]; records: JsonObject; owner: EvidenceOwner; source?: boolean; /** What it's evidence of, which names each link when several lists on a page cite the same location. */ of?: string }) {
  // A record that names its repository, as a Relationship Map's do, reads with it: two repositories' package.json are two locations.
  const locations = evidenceLocations(ids, records).map((location) => {
    const repository = (records[location.id] as JsonObject).repository;
    return typeof repository === "string" ? { ...location, location: `${repository} ${location.location}` } : location;
  });
  return (
    <LocationList
      locations={locations}
      owner={owner}
      of={of}
      detail={source ? (location) => `${String((records[location.id] as JsonObject).detector)} · ${String((records[location.id] as JsonObject).rule)}` : undefined}
    />
  );
}

/** Evidence locations, each linked to its record, with an optional detail line. */
export function LocationList({ locations, owner, detail, of }: { locations: readonly EvidenceLocation[]; owner: EvidenceOwner; detail?: (location: EvidenceLocation) => string; of?: string }) {
  if (!locations.length) return <span className={styles.muted}>No evidence</span>;
  return (
    <ul className={styles.evidence}>
      {locations.map((location) => (
        <li key={location.id}>
          <Link href={routes.evidence(owner, location.id)} className={styles.location} aria-label={of ? `${location.location}, evidence of ${of}` : undefined}>
            {location.location}
          </Link>
          {detail && <span className={styles.source}>{detail(location)}</span>}
        </li>
      ))}
    </ul>
  );
}
