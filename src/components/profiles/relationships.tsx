import Link from "next/link";
import { EDGE_LABELS } from "@/components/relationships/relationships-table";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Table, Td, Th } from "@/components/ui/table";
import { humanize } from "@/components/ui/status";
import type { RelatedRepository, RepositoryRelationships } from "@/lib/profiles/relationships";
import styles from "./profile.module.css";
import { routes } from "@/lib/web/routes";

/**
 * The repositories this one uses and the ones that use it, from the newest
 * Assessment Run that mapped it, with the way to its focus in that Run's
 * Relationship Map. Without such a Run they're unknown, and the section says
 * so rather than showing none.
 */
export function Relationships({ relationships }: { relationships: RepositoryRelationships }) {
  const { run, uses, usedBy, mapHref } = relationships;
  const rows = [...uses.map((repository) => ({ direction: "Uses" as const, repository })), ...usedBy.map((repository) => ({ direction: "Used by" as const, repository }))];
  return (
    <Section
      id="relationships"
      level={3}
      title="Relationships"
      description="Repositories this one uses and is used by, resolved across the newest Assessment Run that included it."
      actions={mapHref ? <Link href={mapHref} className={styles.panelLink}>Open in the Relationship Map</Link> : undefined}
    >
      {!run ? (
        <p className={styles.source}>No Assessment Run has included it with other repositories, so what it uses and what uses it aren&apos;t known. Profiling reads one repository at a time; an Assessment Run that includes the others resolves them.</p>
      ) : (
        <>
          <p className={styles.source}>
            From Run <Link href={routes.run(run.publicId)}>{run.publicId}</Link>
            {run.finishedAt ? (
              <>
                , finished <RelativeTime value={run.finishedAt} />
              </>
            ) : null}
            . It may predate the version shown here.
          </p>
          {rows.length ? (
            <div className={styles.dataTable}>
              <Panel flush>
                <Table
                  label="Relationships"
                  head={
                    <>
                      <Th>Repository</Th>
                      <Th>Direction</Th>
                      <Th>Through</Th>
                    </>
                  }
                >
                  {rows.map(({ direction, repository }) => (
                    <tr key={`${direction}:${repository.publicId}`}>
                      <Td label="Repository">
                        <Link href={routes.repository(repository.publicId)}>{repository.name}</Link>
                      </Td>
                      <Td label="Direction">{direction}</Td>
                      <Td label="Through">{through(repository)}</Td>
                    </tr>
                  ))}
                </Table>
              </Panel>
            </div>
          ) : (
            <p className={styles.source}>It neither uses nor is used by another repository in that Run.</p>
          )}
        </>
      )}
    </Section>
  );
}

/** How two repositories relate, in the Relationship Map's words: Composition, Package dependency. */
function through(repository: RelatedRepository): string {
  return repository.types.map((type) => EDGE_LABELS[type]?.[0] ?? humanize(type)).join(", ");
}
