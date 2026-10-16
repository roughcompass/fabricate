import { inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { countLabel } from "@/components/ui/count";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag, TagList } from "@/components/ui/tag";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { applications } from "@/lib/db/schema";
import { isStale } from "@/lib/home/attention";
import { type DeConsoleConflict, deConsoleStatus, openDeConsoleConflicts } from "@/lib/ownership/de-console";
import { applicationLabel } from "@/lib/ownership/records";

export const metadata: Metadata = { title: "DE Console import · Repositories" };

/**
 * The DE Console import's state and the conflicts waiting for review
 * (page-patterns spec, "The DE Console import page shows reads and open
 * conflicts"). Read-only: it never reads the DE Console, settles a conflict,
 * or shows the source's address or token.
 */
export default function DeConsoleImportPage() {
  const db = getDb();
  const config = getConfig();
  const configured = Boolean(config.deConsole.source);
  const { lastSuccess, lastAttempt } = deConsoleStatus(db);
  const conflicts = openDeConsoleConflicts(db);
  const candidates = candidatesOf(db, conflicts);
  const failed = configured && lastAttempt?.status === "failed" ? lastAttempt : null;
  const stale = configured && !failed && lastSuccess && isStale(lastSuccess.readAt, config.deConsole.refreshMinutes) ? lastSuccess : null;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ href: "/repositories", label: "Repositories" }]}
        title="DE Console import"
        description="The SEAL IDs, teams, and portals DE FabLab reads from the DE Console, and the entries it couldn't match to one application."
        alerts={
          <>
            {failed && (
              <Alert tone="warning" title="The DE Console couldn't be read">
                <p>
                  The latest read, <RelativeTime value={failed.readAt} />, failed: {failed.error ?? "no reason was recorded"}.
                </p>
                <p>
                  {lastSuccess ? (
                    <>
                      DE Console values are from the last successful read, <RelativeTime value={lastSuccess.readAt} />.
                    </>
                  ) : (
                    "Nothing has been read from the DE Console yet."
                  )}
                </p>
              </Alert>
            )}
            {stale && (
              <Alert tone="warning" title="DE Console values are out of date">
                <p>
                  The last successful read was <RelativeTime value={stale.readAt} />, and reads are scheduled every {countLabel(config.deConsole.refreshMinutes, "minute")}.
                </p>
              </Alert>
            )}
          </>
        }
      />

      <DescriptionList
        surface
        layout="columns"
        items={[
          ["Configuration", configured ? "Configured" : "Not configured"],
          ["Refresh interval", configured ? `Every ${countLabel(config.deConsole.refreshMinutes, "minute")}` : "No scheduled reads"],
          [
            "Last successful read",
            lastSuccess ? (
              <>
                <RelativeTime value={lastSuccess.readAt} />
                {lastSuccess.applications !== null && <Secondary>{`${countLabel(lastSuccess.applications, "application")} listed`}</Secondary>}
              </>
            ) : (
              "None yet"
            ),
          ],
          [
            "Latest attempt",
            lastAttempt ? (
              <>
                <Status state={lastAttempt.status} />
                <Secondary>
                  <RelativeTime value={lastAttempt.readAt} />
                </Secondary>
              </>
            ) : (
              "None yet"
            ),
          ],
        ]}
      />

      <Section id="conflicts" title="Conflicts" description="Entries waiting for review, because each could describe more than one application.">
        <Panel flush>
          {conflicts.length > 0 ? (
            <Table
              label="Open DE Console conflicts"
              head={
                <>
                  <Th>Entry</Th>
                  <Th>Reason</Th>
                  <Th>Could describe</Th>
                  <Th>Recorded</Th>
                </>
              }
            >
              {conflicts.map((conflict) => (
                <tr key={conflict.publicId}>
                  <Td label="Entry">
                    <Primary>{conflict.name ?? "Unnamed entry"}</Primary>
                    {conflict.sealId && (
                      <Secondary>
                        <Tag>{conflict.sealId}</Tag>
                      </Secondary>
                    )}
                  </Td>
                  <Td label="Reason">
                    <Status state={conflict.reason} />
                  </Td>
                  <Td label="Could describe">
                    <CandidateList labels={(JSON.parse(conflict.candidates) as string[]).map((publicId) => candidates.get(publicId)).filter((label): label is string => Boolean(label))} />
                  </Td>
                  <Td label="Recorded">
                    <RelativeTime value={conflict.recordedAt} />
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="No open conflicts">Every DE Console entry read so far matches one application.</EmptyState>
          )}
        </Panel>
      </Section>
    </Page>
  );
}

/** The applications the open conflicts could describe, by public ID, read in one query. */
function candidatesOf(db: ReturnType<typeof getDb>, conflicts: readonly DeConsoleConflict[]): Map<string, string> {
  const ids = [...new Set(conflicts.flatMap((conflict) => JSON.parse(conflict.candidates) as string[]))];
  if (ids.length === 0) return new Map();
  return new Map(db.select({ publicId: applications.publicId, name: applications.name, sealId: applications.sealId }).from(applications).where(inArray(applications.publicId, ids)).all().map((row) => [row.publicId, applicationLabel(row)]));
}

function CandidateList({ labels }: { labels: readonly string[] }) {
  return labels.length === 0 ? <Secondary>No application yet</Secondary> : <TagList values={labels} />;
}
