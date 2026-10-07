import { ActionButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { type ExternalReference, REFERENCE_TYPES } from "@/lib/onboarding/external/references";
import { systemLabel } from "@/lib/onboarding/external/reconcile";
import { Attributed } from "./attribution";

const SOURCES = { person: "Stated", declared: "Declared by a revision", discovered: "Discovered" } as const;

/** A record's explicit mappings to Studio and CDaaS resources, each with who stated it, and a way to remove a stated one. */
export function ReferencesTable({ references, remove }: { references: readonly ExternalReference[]; remove: (reference: ExternalReference) => ((formData: FormData) => Promise<void>) | null }) {
  return (
    <Panel flush>
      {references.length > 0 ? (
        <Table
          label="Mappings"
          head={
            <>
              <Th>Resource</Th>
              <Th>ID</Th>
              <Th>Stated by</Th>
              <Th align="actions" hidden>
                Actions
              </Th>
            </>
          }
        >
          {references.map((reference) => {
            const action = remove(reference);
            return (
              <tr key={reference.publicId}>
                <Td label="Resource">
                  {`${systemLabel(reference.system)} ${REFERENCE_TYPES[reference.system][reference.resourceType]?.label.replace(/^(Studio|CDaaS) /, "") ?? reference.resourceType}`}
                  {reference.environment && <Secondary>{reference.environment.toUpperCase()}</Secondary>}
                </Td>
                <Td label="ID">
                  <Tag copy label="external ID">
                    {reference.externalId}
                  </Tag>
                </Td>
                <Td label="Stated by">
                  <Attributed name={reference.providedBy} attribution={reference.attribution} />
                  <Secondary>
                    {`${SOURCES[reference.source]}, `}
                    <RelativeTime value={reference.recordedAt} />
                  </Secondary>
                </Td>
                <Td align="actions">
                  {action && (
                    <RowActions>
                      <ActionButton action={action} variant="tertiary" size="sm" icon="trash" label={`Remove the mapping to ${reference.externalId}`} />
                    </RowActions>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <EmptyState title="Not mapped">Map this record to the resource that represents it, by that resource&apos;s ID. Nothing is matched by name.</EmptyState>
      )}
    </Panel>
  );
}
