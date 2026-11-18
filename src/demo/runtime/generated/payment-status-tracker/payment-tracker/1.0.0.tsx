import { usePublish } from "@deweb/portal";
import { Button, Display3, FlexLayout, FormField, FormFieldLabel, GridLayout, H2, Input, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { type Payment, PAYMENTS, STAGES, UPDATED } from "../data";
import styles from "./1.0.0.module.css";

const money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const progress = (payment: Payment) => (payment.stall ? "Stalled" : payment.stage === "Settled" ? "Settled" : "On track");
const TONE = { Stalled: "error", Settled: "success", "On track": "info" } as const;

export default function PaymentTracker() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(PAYMENTS[0]!.id);
  const publish = usePublish("payment-tracker");
  const search = query.trim().toLowerCase();
  const rows = PAYMENTS.filter((payment) => payment.reference.toLowerCase().includes(search) || payment.beneficiary.toLowerCase().includes(search));

  const choose = (payment: Payment) => {
    setSelected(payment.id);
    publish("payment:selected", { id: payment.id, name: payment.reference });
  };

  return (
    <Panel data-demo-anchor="payment-tracker-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Payments</H2>
          <Text styleAs="label" color="secondary">{`Today's payments, updated ${UPDATED}`}</Text>
        </FlexLayout>
        <GridLayout columns={{ xs: 2, sm: 4 }} gap={2} as="ul" className={styles.list} aria-label="Payments by stage">
          {STAGES.map((stage) => (
            <StackLayout as="li" key={stage} gap={1}>
              <Text styleAs="label" color="secondary">
                {stage}
              </Text>
              <Display3 className={styles.figure}>{PAYMENTS.filter((payment) => payment.stage === stage).length}</Display3>
            </StackLayout>
          ))}
        </GridLayout>
        <FormField>
          <FormFieldLabel>Find a payment</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="Reference or beneficiary"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "payment-search" }}
          />
        </FormField>
        {rows.length === 0 ? (
          <Text color="secondary">{`No payments match "${query.trim()}". Clear the search to see every payment.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Payments">
              <THead sticky>
                <TR>
                  <TH>Reference</TH>
                  <TH>Beneficiary</TH>
                  <TH textAlign="right">Amount</TH>
                  <TH>Stage</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((payment) => {
                  const current = payment.id === selected;
                  const status = progress(payment);
                  return (
                    <TR key={payment.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`payment-${payment.id}`}>
                      <TD>
                        <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(payment)}>
                          {payment.reference}
                        </Button>
                      </TD>
                      <TD>{payment.beneficiary}</TD>
                      <TD textAlign="right" className={styles.figure}>
                        {money(payment.currency, payment.amount)}
                      </TD>
                      <TD>
                        <StackLayout gap={1}>
                          <Text>{payment.stage}</Text>
                          <Text styleAs="label" color="secondary">{`Stage ${STAGES.indexOf(payment.stage) + 1} of ${STAGES.length} · ${payment.rail}`}</Text>
                        </StackLayout>
                      </TD>
                      <TD>
                        <FlexLayout gap={1} align="center" wrap={false}>
                          <StatusIndicator status={TONE[status]} />
                          <Text>{status}</Text>
                        </FlexLayout>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </StackLayout>
    </Panel>
  );
}
