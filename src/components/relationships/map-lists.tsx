import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Primary, Table, Td, Th } from "@/components/ui/table";
import type { GroupLink, LevelGroup, LevelRelationship, Membership, SharedEntry } from "@/lib/relationships/levels";
import styles from "./relationships.module.css";

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
                    <Link href={group.href}>{group.label}</Link>
                  </Primary>
                </Td>
                <Td label="Repositories" align="numeric">
                  {group.repositories.toLocaleString("en-US")}
                </Td>
                <Td label="Relationships inside" align="numeric">
                  {group.internal.toLocaleString("en-US")}
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
                <Link href={relationship.from.href}>{relationship.from.label}</Link>
              </Td>
              <Td label="To">
                <Link href={relationship.to.href}>{relationship.to.label}</Link>
              </Td>
              <Td label="Repository relationships" align="numeric">
                {relationship.repositoryRelationships.toLocaleString("en-US")}
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
                {entry.dependents.toLocaleString("en-US")}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </Section>
  );
}

/** A portal's claims beside what its host loads. */
export function MembershipLists({ membership, hostName }: { membership: Membership; hostName: string | null }) {
  if (!membership.comparable) {
    return (
      <Section title="Claims and loading" description="Applications claimed in this portal compared with what its host loads.">
        <Panel>
          <p className={styles.muted}>{hostName ? `Its host, ${hostName}, isn't in this Run, so its loading can't be compared with its claims.` : "No repository is claimed as this portal's host, so its loading can't be compared with its claims."}</p>
        </Panel>
      </Section>
    );
  }
  return (
    <Section title="Claims and loading" description="Applications claimed in this portal compared with what its host loads.">
      <Panel>
        <div className={styles.lists}>
          <LinkList title="Claimed but not loaded" empty="The host loads every application claimed here." items={membership.claimedNotLoaded} />
          <LinkList title="Loaded but not claimed" empty="Every repository the host loads is claimed here." items={membership.loadedNotClaimed.map((item) => ({ key: item.nodeId, label: item.label, href: item.href }))} />
        </div>
      </Panel>
    </Section>
  );
}

function LinkList({ title, empty, items }: { title: string; empty: string; items: readonly GroupLink[] }) {
  return (
    <section className={styles.list} aria-label={title}>
      <h3 className={styles.listTitle}>{`${title} (${items.length.toLocaleString("en-US")})`}</h3>
      {items.length === 0 ? (
        <p className={styles.muted}>{empty}</p>
      ) : (
        <ul className={styles.rows}>
          {items.map((item) => (
            <li key={item.key}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
