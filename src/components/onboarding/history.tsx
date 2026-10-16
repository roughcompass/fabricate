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
  details_changed: "Details changed",
  menu_changed: "Menu changed",
  default_changed: "Default route changed",
  promoted: "Promoted to Production",
  returned_to_prototype: "Returned to Prototype",
};

/** A record's history, newest first, each change with who stated they made it. */
export function ChangeHistory({ events }: { events: readonly Event[] }) {
  return (
    <Panel flush>
      {events.length > 0 ? (
        <Table
          label="History"
          head={
            <>
              <Th>Change</Th>
              <Th>By</Th>
              <Th>When</Th>
            </>
          }
        >
          {events.map((event) => (
            <tr key={event.id}>
              <Td label="Change">
                {event.toLifecycle && event.event !== "created" ? (
                  <span>
                    {EVENTS[event.event]} <Status state={event.toLifecycle} size="sm" />
                  </span>
                ) : (
                  EVENTS[event.event]
                )}
                {event.detail && <Secondary>{event.detail}</Secondary>}
              </Td>
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
        <EmptyState title="No changes yet">Each detail, menu, default, and lifecycle change appears here.</EmptyState>
      )}
    </Panel>
  );
}
