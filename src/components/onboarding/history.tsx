import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Status } from "@/components/ui/status";
import { Secondary, Table, Td, Th } from "@/components/ui/table";
import type { onboardingEvents } from "@/lib/db/schema";
import { Attributed } from "./attribution";

type Event = typeof onboardingEvents.$inferSelect;

const EVENTS: Record<Event["event"], string> = {
  created: "Created",
  draft_started: "Draft started",
  submitted: "Submitted",
  ready: "Became Ready",
  not_ready: "No longer Ready",
  activated: "Activated",
  revision_activated: "Revision activated",
  retired: "Retired",
  metadata_changed: "Details changed",
};

/** A record's lifecycle and revision history, newest first, each change with who made it. */
export function LifecycleHistory({ events }: { events: readonly Event[] }) {
  return (
    <Panel flush>
      {events.length > 0 ? (
        <Table
          label="Lifecycle history"
          head={
            <>
              <Th>Change</Th>
              <Th>Revision</Th>
              <Th>By</Th>
              <Th>When</Th>
            </>
          }
        >
          {events.map((event) => (
            <tr key={event.id}>
              <Td label="Change">
                {event.toLifecycle && event.event !== "created" && event.event !== "draft_started" && event.event !== "submitted" ? <Status state={event.toLifecycle} label={EVENTS[event.event]} /> : EVENTS[event.event]}
                {event.reason && <Secondary>{event.reason}</Secondary>}
              </Td>
              <Td label="Revision">{event.revision ?? "—"}</Td>
              <Td label="By">
                <Attributed name={event.actor} attribution={event.attribution} />
              </Td>
              <Td label="When">
                <RelativeTime value={event.occurredAt} />
              </Td>
            </tr>
          ))}
        </Table>
      ) : (
        <EmptyState title="No changes yet">Creating, submitting, and each lifecycle change appear here.</EmptyState>
      )}
    </Panel>
  );
}
