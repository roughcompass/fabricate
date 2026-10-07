import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue } from "@/components/ui/tag";
import type { Revision } from "@/lib/onboarding/revisions";

/** Every revision of a record, newest first: the Draft, then each submitted revision with who submitted it. */
export function RevisionsTable({ revisions, href, active, draftHref }: { revisions: readonly Revision[]; href: (number: number) => string; active: number | null; draftHref: string }) {
  const ordered = [...revisions].reverse();
  return (
    <Panel flush>
      {ordered.length > 0 ? (
        <Table
          label="Revisions"
          head={
            <>
              <Th>Revision</Th>
              <Th>State</Th>
              <Th>Submitted</Th>
              <Th>Digest</Th>
            </>
          }
        >
          {ordered.map((revision) => (
            <tr key={revision.id}>
              <Td label="Revision">
                <Primary>
                  <Link href={revision.state === "draft" ? draftHref : href(revision.number)}>{`Revision ${revision.number}`}</Link>
                </Primary>
                {revision.id === active && <Secondary>Active</Secondary>}
              </Td>
              <Td label="State">
                <Status state={revision.state === "draft" ? "draft" : "submitted"} />
              </Td>
              <Td label="Submitted">
                {revision.submittedAt ? (
                  <>
                    <RelativeTime value={revision.submittedAt} />
                    <Secondary>{`By ${revision.submittedBy}, unverified`}</Secondary>
                  </>
                ) : (
                  <Secondary>
                    Last saved <RelativeTime value={revision.updatedAt} />
                  </Secondary>
                )}
              </Td>
              <Td label="Digest">{revision.digest ? <ShortValue value={revision.digest} label="digest" /> : "—"}</Td>
            </tr>
          ))}
        </Table>
      ) : (
        <EmptyState title="No revisions yet">Start a Draft to onboard this record.</EmptyState>
      )}
    </Panel>
  );
}
