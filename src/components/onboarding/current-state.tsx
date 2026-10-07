import { ActionButton } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { type StateItem, groupByState } from "@/lib/onboarding/external/current-state";
import { RECONCILIATION_LABELS, referenceLabel, systemLabel } from "@/lib/onboarding/external/reconcile";
import styles from "./onboarding.module.css";

/**
 * Current state in Studio and CDaaS, compared with what was onboarded:
 * grouped by Matching, Missing, Conflicting, Unknown, and Stale, each with
 * the revision expected and the observation's source and time.
 */
export function CurrentState({ items, refresh, description }: { items: readonly StateItem[]; refresh?: (formData: FormData) => void | Promise<void>; description?: string }) {
  const groups = groupByState(items);
  return (
    <Section
      title="Current state"
      description={description ?? "What Studio and CDaaS last reported, compared with what was onboarded. Nothing here changes either system."}
      actions={
        refresh && (
          <ActionButton action={refresh} icon="refresh">
            Read again
          </ActionButton>
        )
      }
    >
      {groups.length === 0 ? (
        <Panel flush>
          <EmptyState title="Nothing to compare">Map this record to a Studio or CDaaS resource to compare it with their current state.</EmptyState>
        </Panel>
      ) : (
        groups.map((group) => (
          <Disclosure key={group.state} summary={<Status state={group.state} label={`${RECONCILIATION_LABELS[group.state]} · ${group.items.length}`} />} defaultOpen={group.state !== "matching"}>
            <Table
              label={`${RECONCILIATION_LABELS[group.state]} results`}
              head={
                <>
                  <Th>Compared</Th>
                  <Th>Values</Th>
                  <Th>Observed</Th>
                </>
              }
            >
              {group.items.map((item, index) => (
                <tr key={`${item.subject}-${index}`}>
                  <Td label="Compared">
                    {item.subject}
                    <Secondary>{item.reason}</Secondary>
                  </Td>
                  <Td label="Values">
                    {item.values.length > 0 ? (
                      <dl className={styles.values}>
                        {item.values.map((value) => (
                          <div key={value.label} className={styles.pair}>
                            <dt>{value.label}</dt>
                            <dd className={value.matches ? undefined : styles.mismatch}>{`Expected ${value.expected || "none"}; ${value.observed === null ? "not observed" : `observed ${value.observed || "none"}`}`}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <Secondary>{`Expected by ${item.desired}`}</Secondary>
                    )}
                  </Td>
                  <Td label="Observed">
                    {item.reference ? (
                      <>
                        <Tag label="external ID">{referenceLabel(item.reference)}</Tag>
                        <Secondary>
                          {item.observedAt ? (
                            <>
                              {`${systemLabel(item.system)}, `}
                              <RelativeTime value={item.observedAt} />
                            </>
                          ) : (
                            "Not observed yet"
                          )}
                        </Secondary>
                      </>
                    ) : (
                      <Secondary>Not mapped</Secondary>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Disclosure>
        ))
      )}
    </Section>
  );
}
