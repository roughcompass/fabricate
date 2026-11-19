import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Primary, Table, Td, Th } from "@/components/ui/table";
import type { LevelGroup, LevelRelationship, SharedEntry } from "@/lib/relationships/levels";
import { formatNumber } from "@/components/ui/count";

/** The groups of a level, each with its repositories and the relationships folded inside it. */
export function GroupTable({ title, description, label, groups, empty }: { title: string; description?: string; label: string; groups: readonly LevelGroup[]; empty: string }) {
  return (
    <Section title={title} description={description}>
      <Panel flush>
        {groups.length > 0 ? (
          <Table
            label={label}
            head={
              <>
                <Th>{label}</Th>
                <Th align="numeric">Repositories</Th>
                <Th align="numeric">Relationships inside</Th>
              </>
            }
          >
            {groups.map((group) => (
              <tr key={group.key}>
                <Td label={label}>
                  <Primary>
                    <Link href={group.href} aria-label={`${group.label} runtime system`}>
                      {group.label}
                    </Link>
                  </Primary>
                </Td>
                <Td label="Repositories" align="numeric">
                  {formatNumber(group.repositories)}
                </Td>
                <Td label="Relationships inside" align="numeric">
                  {formatNumber(group.internal)}
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState title={empty} />
        )}
      </Panel>
    </Section>
  );
}

/** Relationships between the groups of a level, each counting the repository relationships it rolls up. */
export function GroupRelationships({ relationships, description }: { relationships: readonly LevelRelationship[]; description: string }) {
  if (relationships.length === 0) return null;
  return (
    <Section title="Between groups" description={description}>
      <Panel flush>
        <Table
          label="Between groups"
          head={
            <>
              <Th>From</Th>
              <Th>To</Th>
              <Th align="numeric">Repository relationships</Th>
            </>
          }
        >
          {relationships.map((relationship) => (
            <tr key={`${relationship.from.key}-${relationship.to.key}`}>
              <Td label="From">
                <EndpointLink endpoint={relationship.from} />
              </Td>
              <Td label="To">
                <EndpointLink endpoint={relationship.to} />
              </Td>
              <Td label="Repository relationships" align="numeric">
                {formatNumber(relationship.repositoryRelationships)}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </Section>
  );
}

/** The libraries built in the Run and the services that this level's repositories depend on. */
export function SharedList({ entries }: { entries: readonly SharedEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <Section title="Shared libraries and services" description="Libraries built in this Run, and services, that repositories here depend on, with how many of them do.">
      <Panel flush>
        <Table
          label="Shared libraries and services"
          head={
            <>
              <Th>Name</Th>
              <Th>Kind</Th>
              <Th align="numeric">Dependents here</Th>
            </>
          }
        >
          {entries.map((entry) => (
            <tr key={entry.nodeId}>
              <Td label="Name">
                <Primary>
                  <Link href={entry.href}>{entry.label}</Link>
                </Primary>
              </Td>
              <Td label="Kind">{entry.kind === "library" ? "Library" : "Service"}</Td>
              <Td label="Dependents here" align="numeric">
                {formatNumber(entry.dependents)}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </Section>
  );
}

/** A relationship's end: a runtime system's link names it as a system, apart from the repository it's named after, whose link opens its focus. */
function EndpointLink({ endpoint }: { endpoint: { href: string; label: string } }) {
  return (
    <Link href={endpoint.href} aria-label={endpoint.href.includes("/systems/") ? `${endpoint.label} runtime system` : undefined}>
      {endpoint.label}
    </Link>
  );
}
