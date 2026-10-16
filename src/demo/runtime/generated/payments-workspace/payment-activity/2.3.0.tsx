import { useState } from "react";
import {
  Button,
  Card,
  Display3,
  FlexLayout,
  GridLayout,
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
import { RefreshIcon } from "@salt-ds/icons";
import { planted, useProfile } from "@deweb/portal";
import { ACTIVITY } from "../data";

type Status = "Settled" | "Pending approval" | "Failed" | "Approved";

const STATUS_INDICATOR = {
  Settled: "success",
  "Pending approval": "info",
  Failed: "error",
  Approved: "success",
} as const;

function StatusCell({ status }: { status: Status }) {
  return (
    <FlexLayout gap={1} align="center">
      <StatusIndicator status={STATUS_INDICATOR[status]} />
      <Text>{status}</Text>
    </FlexLayout>
  );
}

function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "info" | "error";
}) {
  return (
    <Card>
      <StackLayout gap={1}>
        <FlexLayout gap={1} align="center">
          {tone && <StatusIndicator status={tone} />}
          <Text color="secondary">{label}</Text>
        </FlexLayout>
        <Display3>{value}</Display3>
        <Text color="secondary" styleAs="label">
          {detail}
        </Text>
      </StackLayout>
    </Card>
  );
}

export default function PaymentActivity() {
  const approver = useProfile().persona === "Approver";
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [recalculated, setRecalculated] = useState<number>(0);

  return (
    <Panel data-demo-anchor="activity-panel">
      <StackLayout gap={3}>
        <FlexLayout justify="space-between" align="center" wrap gap={2}>
          <H2>Payment activity</H2>
          <Button
            sentiment="neutral"
            appearance="bordered"
            onClick={() => {
              planted.blockMainThread(650);
              setRecalculated((count) => count + 1);
            }}
            data-demo-anchor="recalculate-totals"
          >
            <RefreshIcon aria-hidden />
            Recalculate totals
          </Button>
        </FlexLayout>

        <GridLayout columns="repeat(auto-fit, minmax(calc(var(--salt-size-base) * 9), 1fr))" gap={2}>
          <Metric label="Sent today" value="$30,172.35" detail="5 payments" />
          <Metric
            label="Pending approval"
            value={`${2 - approved.length}`}
            detail="Needs an Approver"
            tone="info"
          />
          <Metric label="Failed" value="1" detail="Retry before 4 p.m." tone="error" />
        </GridLayout>

        {recalculated > 0 && (
          <Text color="secondary">
            {`Totals recalculated ${recalculated === 1 ? "once" : `${recalculated} times`} this session.`}
          </Text>
        )}

        <TableContainer>
          <Table aria-label="Today's payments">
            <THead>
              <TR>
                <TH>Payment</TH>
                <TH>Payee</TH>
                <TH style={{ textAlign: "right" }}>Amount</TH>
                <TH>Status</TH>
                {approver && <TH>Approval</TH>}
              </TR>
            </THead>
            <TBody>
              {ACTIVITY.map((payment) => {
                const status: Status = approved.includes(payment.id)
                  ? "Approved"
                  : payment.status;
                return (
                  <TR key={payment.id} data-demo-anchor={`payment-${payment.id}`}>
                    <TD>{payment.id}</TD>
                    <TD>{payment.payee}</TD>
                    <TD style={{ textAlign: "right" }}>{`$${payment.amount}`}</TD>
                    <TD>
                      <StatusCell status={status} />
                    </TD>
                    {approver && (
                      <TD>
                        {status === "Pending approval" ? (
                          <Button
                            sentiment="accented"
                            appearance="solid"
                            onClick={() =>
                              setApproved((ids) => [...ids, payment.id])
                            }
                            data-demo-anchor={`approve-${payment.id}`}
                          >
                            {`Approve ${payment.id}`}
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

        {!approver && (
          <Text color="secondary">Approvals are available to the Approver role.</Text>
        )}
      </StackLayout>
    </Panel>
  );
}
