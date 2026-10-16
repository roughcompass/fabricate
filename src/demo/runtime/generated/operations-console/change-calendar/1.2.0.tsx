import { useState } from "react";
import {
  Button,
  FlexLayout,
  H2,
  Panel,
  StackLayout,
  StatusIndicator,
  Table,
  TableContainer,
  TBody,
  TD,
  Text,
  TH,
  THead,
  TR,
} from "@salt-ds/core";
import { CalendarIcon } from "@salt-ds/icons";
import { planted, useProfile } from "@deweb/portal";
import { CHANGES } from "../data";

export default function ChangeCalendar() {
  const approver = useProfile().persona === "Approver";
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [checked, setChecked] = useState(false);

  return (
    <Panel data-demo-anchor="changes-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={2} wrap>
          <H2>Change calendar</H2>
          <Button
            sentiment="neutral"
            appearance="bordered"
            onClick={() => {
              planted.blockMainThread(650);
              setChecked(true);
            }}
            data-demo-anchor="check-conflicts"
          >
            <CalendarIcon aria-hidden />
            Check for conflicts
          </Button>
        </FlexLayout>
        {checked && (
          <Text color="secondary" aria-live="polite">
            No conflicting changes this week.
          </Text>
        )}
        <TableContainer>
          <Table aria-label="Changes this week">
            <THead>
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
                const awaiting = status === "Awaiting approval";
                return (
                  <TR key={change.id} data-demo-anchor={`change-${change.id}`}>
                    <TD>{`${change.id} · ${change.title}`}</TD>
                    <TD>{change.window}</TD>
                    <TD>{change.risk}</TD>
                    <TD>
                      <FlexLayout gap={1} align="center">
                        <StatusIndicator status={awaiting ? "warning" : "success"} />
                        <Text>{status}</Text>
                      </FlexLayout>
                    </TD>
                    {approver && (
                      <TD>
                        {awaiting ? (
                          <Button
                            sentiment="accented"
                            appearance="solid"
                            onClick={() => setApproved((ids) => [...ids, change.id])}
                            data-demo-anchor={`approve-${change.id}`}
                          >
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
