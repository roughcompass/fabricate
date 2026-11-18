import { useProfile } from "@deweb/portal";
import { Button, Display3, FlexLayout, GridLayout, H2, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { RefreshIcon } from "@salt-ds/icons";
import { useState } from "react";
import { ACTIVITY, type PaymentStatus, money, usd } from "../data";
import styles from "./2.3.0.module.css";

type Status = PaymentStatus | "Approved";

const TONE = {
  Settled: "success",
  Approved: "success",
  "Pending approval": "info",
  Failed: "error",
} as const;

function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Display3 className={styles.figure}>{value}</Display3>
      <Text color="secondary">{detail}</Text>
    </StackLayout>
  );
}

export default function PaymentActivity() {
  const approver = useProfile().persona === "Approver";
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [recalculated, setRecalculated] = useState(0);
  const status = (payment: (typeof ACTIVITY)[number]): Status => (approved.includes(payment.id) ? "Approved" : payment.status);
  const total = ACTIVITY.reduce((sum, payment) => sum + payment.amount, 0);
  const pending = ACTIVITY.filter((payment) => status(payment) === "Pending approval").length;
  const failed = ACTIVITY.filter((payment) => status(payment) === "Failed").length;

  return (
    <Panel data-demo-anchor="activity-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={1} wrap>
          <H2>Payment activity</H2>
          <Button sentiment="neutral" appearance="bordered" onClick={() => setRecalculated((count) => count + 1)} data-demo-anchor="recalculate-totals">
            <RefreshIcon aria-hidden />
            Recalculate totals
          </Button>
        </FlexLayout>
        <GridLayout columns={{ xs: 1, sm: 3 }} gap={2}>
          <Figure label="Sent today (USD)" value={money(total)} detail={`${ACTIVITY.length} payments`} />
          <Figure label="Pending approval" value={`${pending}`} detail="Needs an Approver" />
          <Figure label="Failed" value={`${failed}`} detail="Retry before 16:00 ET" />
        </GridLayout>
        <Text role="status" color="secondary">
          {recalculated > 0 ? `Totals recalculated ${recalculated === 1 ? "once" : `${recalculated} times`} this session.` : ""}
        </Text>
        <TableContainer>
          <Table aria-label="Today's payments">
            <THead sticky>
              <TR>
                <TH>Payment</TH>
                <TH>Time</TH>
                <TH>Payee</TH>
                <TH textAlign="right">Amount</TH>
                <TH>Status</TH>
                {approver && <TH>Approval</TH>}
              </TR>
            </THead>
            <TBody>
              {ACTIVITY.map((payment) => {
                const current = status(payment);
                return (
                  <TR key={payment.id} data-demo-anchor={`payment-${payment.id}`}>
                    <TD>{payment.id}</TD>
                    <TD className={styles.figure}>{payment.time}</TD>
                    <TD>{payment.payee}</TD>
                    <TD textAlign="right" className={styles.figure}>
                      {usd(payment.amount)}
                    </TD>
                    <TD>
                      <FlexLayout gap={1} align="center">
                        <StatusIndicator status={TONE[current]} aria-hidden />
                        <Text>{current}</Text>
                      </FlexLayout>
                    </TD>
                    {approver && (
                      <TD>
                        {current === "Pending approval" ? (
                          <Button sentiment="accented" appearance="transparent" onClick={() => setApproved((ids) => [...ids, payment.id])} data-demo-anchor={`approve-${payment.id}`}>
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
        {!approver && <Text color="secondary">Approvals are available to the Approver role.</Text>}
      </StackLayout>
    </Panel>
  );
}
