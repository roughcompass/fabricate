import { useProfile } from "@deweb/portal";
import { Button, FlexLayout, H2, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { CalendarIcon } from "@salt-ds/icons";
import { useState } from "react";
import { CHANGES, WEEK } from "../data";

const AWAITING = "Awaiting approval";

export default function ChangeCalendar() {
  const approver = useProfile().persona === "Approver";
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [checked, setChecked] = useState(false);

  return (
    <Panel data-demo-anchor="changes-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={2} wrap>
          <StackLayout gap={1}>
            <H2>Change calendar</H2>
            <Text styleAs="label" color="secondary" role="status">
              {checked ? `Week of ${WEEK}. No conflicting changes this week.` : `Week of ${WEEK}`}
            </Text>
          </StackLayout>
          <Button sentiment="neutral" appearance="bordered" onClick={() => setChecked(true)} data-demo-anchor="check-conflicts">
            <CalendarIcon aria-hidden />
            Check for conflicts
          </Button>
        </FlexLayout>
        <TableContainer>
          <Table aria-label="Changes this week">
            <THead sticky>
              <TR>
                <TH>Change</TH>
                <TH>Window</TH>
                <TH>Risk</TH>
                <TH>Status</TH>
                {approver && <TH>Approval</TH>}
              </TR>
            </THead>
            <TBody>
              {CHANGES.map((change) => {
                const status: string = approved.includes(change.id) ? "Approved" : change.status;
                const awaiting = status === AWAITING;
                return (
                  <TR key={change.id} data-demo-anchor={`change-${change.id}`}>
                    <TD>
                      <StackLayout gap={0}>
                        <Text>{`${change.id} · ${change.title}`}</Text>
                        <Text styleAs="label" color="secondary">
                          {change.owner}
                        </Text>
                      </StackLayout>
                    </TD>
                    <TD>{change.window}</TD>
                    <TD>{change.risk}</TD>
                    <TD>
                      <FlexLayout gap={1} align="center" wrap={false}>
                        <StatusIndicator status={awaiting ? "warning" : "success"} />
                        <Text>{status}</Text>
                      </FlexLayout>
                    </TD>
                    {approver && (
                      <TD>
                        {awaiting ? (
                          <Button sentiment="accented" appearance="transparent" onClick={() => setApproved((ids) => [...ids, change.id])} data-demo-anchor={`approve-${change.id}`}>
                            {`Approve ${change.id}`}
                          </Button>
                        ) : (
                          <Text color="secondary">None needed</Text>
                        )}
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>
        {!approver && <Text color="secondary">Changes are approved by the Approver role.</Text>}
      </StackLayout>
    </Panel>
  );
}
