import { DescriptionList, type DescriptionItem } from "@/components/ui/description-list";
import { RelativeTime } from "@/components/ui/relative-time";
import type { Effective, Provenance } from "@/lib/ownership/effective";
import type { ApplicationOwnership, ApplicationRef, LabelRef, PortalOwnership, RepositoryRef } from "@/lib/ownership/read";
import styles from "./ownership-values.module.css";

interface OwnershipValuesProps {
  /** The repository's link to its SEAL application; null while a claim is choosing one. */
  link: Effective<ApplicationRef> | null;
  /** The SEAL ID a claim chose, shown when the repository isn't linked yet. */
  chosenSealId?: string | null;
  application: ApplicationOwnership | null;
  /** The portals this repository is claimed to host, with each one's host and owner. */
  hosts?: readonly PortalOwnership[];
  /** When the DE Console last confirmed its values. */
  consoleReadAt: Date | null;
  surface?: boolean;
}

/** Ownership values, each with where it came from, who stated it, how far it's trusted, and any conflict. */
export function OwnershipValues({ link, chosenSealId, application, hosts = [], consoleReadAt, surface = false }: OwnershipValuesProps) {
  const from = (provenance: Provenance | null) => <Source provenance={provenance} consoleReadAt={consoleReadAt} />;
  const sealApplication = (value: ApplicationRef) => `${value.sealId}${value.name ? ` · ${value.name}` : ""}`;
  const items: DescriptionItem[] = [
    [
      "SEAL application",
      link?.value ? (
        <Value effective={link} label={sealApplication} from={from} />
      ) : chosenSealId ? (
        <>
          {application ? sealApplication(application.application) : chosenSealId}
          <span className={styles.source}>Chosen for this claim</span>
        </>
      ) : (
        <Unknown />
      ),
    ],
  ];
  if (application) {
    items.push(
      ["Team", <Value key="team" effective={application.team} label={(team) => team} from={from} />],
      ["Line of Business", <Value key="line" effective={application.lineOfBusiness} label={pendingLabel} from={from} />],
      [
        "Portals",
        application.portals.length === 0 ? (
          <Unknown />
        ) : (
          <ul className={styles.list}>
            {application.portals.map((item) => (
              <li key={item.portal.publicId}>
                {pendingLabel(item.portal)}
                {item.flagged && <span className={styles.flag}> · Not listed by the DE Console</span>}
                {from(item.provenance)}
              </li>
            ))}
          </ul>
        ),
      ],
    );
  }
  if (hosts.length > 0) {
    items.push([
      "Hosts",
      <ul key="hosts" className={styles.list}>
        {hosts.map((hosted) => (
          <li key={hosted.portal.publicId}>
            {pendingLabel(hosted.portal)}
            <span className={styles.source}>{hosted.owner.value ? `Owned by ${sealApplication(hosted.owner.value)}` : "No owner yet"}</span>
            <span className={styles.source}>
              Host: <Value effective={hosted.host} label={(repository: RepositoryRef) => repository.name} from={from} />
            </span>
          </li>
        ))}
      </ul>,
    ]);
  }
  return <DescriptionList items={items} surface={surface} />;
}

/** A portal or Line of Business no ontology release has approved yet is labeled so. */
export function pendingLabel(value: LabelRef): string {
  return value.conceptKey ? value.label : `${value.label} (pending review)`;
}

function Value<T>({ effective, label, from }: { effective: Effective<T>; label: (value: T) => string; from: (provenance: Provenance | null) => React.ReactNode }) {
  if (effective.value === null) return <Unknown />;
  const others = effective.candidates.slice(1);
  return (
    <>
      {label(effective.value)}
      {from(effective.provenance)}
      {effective.conflict && (
        <span className={styles.flag}>
          In conflict with{" "}
          {others.map((candidate, index) => (
            <span key={candidate.provenance.assertion}>
              {index > 0 && "; "}
              {label(candidate.value)}, {sourceText(candidate.provenance).replace(/^[A-Z]/, (first) => first.toLowerCase())}
            </span>
          ))}
        </span>
      )}
    </>
  );
}

function Source({ provenance, consoleReadAt }: { provenance: Provenance | null; consoleReadAt: Date | null }) {
  if (!provenance) return null;
  if (provenance.source === "de_console") {
    return (
      <span className={styles.source}>
        From the DE Console · last read <RelativeTime value={consoleReadAt ?? provenance.readAt} />
      </span>
    );
  }
  return (
    <span className={styles.source}>
      {sourceText(provenance)} ·{" "}
      {provenance.verification === "verified" ? (
        <>
          Verified <RelativeTime value={provenance.verifiedAt} />
        </>
      ) : (
        "Unverified"
      )}
    </span>
  );
}

function sourceText(provenance: Provenance): string {
  if (provenance.source === "de_console") return "from the DE Console";
  const by = `${provenance.source === "bulk_import" ? "Imported" : "Claimed"} by ${provenance.providedBy}`;
  return provenance.attributedTo ? `${by} for ${provenance.attributedTo}` : by;
}

function Unknown() {
  return <span className={styles.unknown}>Unknown</span>;
}
