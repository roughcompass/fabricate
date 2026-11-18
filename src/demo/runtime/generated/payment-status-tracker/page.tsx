// Payment status tracker: the Payments route as one page, composed from its microfrontends at their conformant versions:
// payment-tracker 1.1.0 (main)
// stall-alerts 1.0.0 (side)
import { useBus, usePublish } from "@deweb/portal";
import { Banner, BannerContent, Button, Display3, Display4, Dropdown, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridItem, GridLayout, H2, H3, Input, MultilineInput, Option, Panel, StackLayout, StatusIndicator, Step, Stepper, Table, TableContainer, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { type Payment, PAYMENTS, STAGE_DETAIL, STAGES, type Stall, UPDATED } from "./data";
import styles from "./page.module.css";

const PaymentTracker_money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PaymentTracker_progress = (payment: Payment) => (payment.stall ? "Stalled" : payment.stage === "Settled" ? "Settled" : "On track");

const PaymentTracker_TONE = { Stalled: "error", Settled: "success", "On track": "info" } as const;

const PaymentTracker_ALL = "All stages";

const PaymentTracker_STALLED = "Stalled only";

const PaymentTracker_FILTERS = [PaymentTracker_ALL, ...STAGES, PaymentTracker_STALLED];

function PaymentTracker() {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState(PaymentTracker_ALL);
  const [selected, setSelected] = useState(PAYMENTS[0]!.id);
  const publish = usePublish("payment-tracker");
  const search = query.trim().toLowerCase();
  const inStage = (payment: Payment) => stage === PaymentTracker_ALL || (stage === PaymentTracker_STALLED ? payment.stall !== undefined : payment.stage === stage);
  const rows = PAYMENTS.filter((payment) => inStage(payment) && (payment.reference.toLowerCase().includes(search) || payment.beneficiary.toLowerCase().includes(search)));
  const scope = stage === PaymentTracker_ALL ? "payments" : stage === PaymentTracker_STALLED ? "stalled payments" : `payments at ${stage}`;
  const empty = search ? `No ${scope} match "${query.trim()}". Clear the search${stage === PaymentTracker_ALL ? "" : " or choose All stages"} to see more.` : `No ${scope} right now. Choose All stages to see every payment.`;

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
        <GridLayout columns={{ xs: 2, sm: 4 }} gap={2} as="ul" className={styles["PaymentTracker_list"]} aria-label="Payments by stage">
          {STAGES.map((stage) => (
            <StackLayout as="li" key={stage} gap={1}>
              <Text styleAs="label" color="secondary">
                {stage}
              </Text>
              <Display3 className={styles["PaymentTracker_figure"]}>{PAYMENTS.filter((payment) => payment.stage === stage).length}</Display3>
            </StackLayout>
          ))}
        </GridLayout>
        <GridLayout columns={{ xs: 1, sm: 3 }} gap={2}>
          <GridItem colSpan={{ xs: 1, sm: 2 }}>
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
          </GridItem>
          <FormField>
            <FormFieldLabel>Stage</FormFieldLabel>
            <Dropdown value={stage} selected={[stage]} onSelectionChange={(_event, next: string[]) => setStage(next[0] ?? PaymentTracker_ALL)}>
              {PaymentTracker_FILTERS.map((option) => (
                <Option key={option} value={option} />
              ))}
            </Dropdown>
          </FormField>
        </GridLayout>
        {rows.length === 0 ? (
          <Text color="secondary">{empty}</Text>
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
                  const status = PaymentTracker_progress(payment);
                  return (
                    <TR key={payment.id} aria-current={current ? "true" : undefined} className={current ? styles["PaymentTracker_selected"] : undefined} data-demo-anchor={`payment-${payment.id}`}>
                      <TD>
                        <Button sentiment="neutral" appearance="transparent" className={styles["PaymentTracker_recordName"]} aria-pressed={current} onClick={() => choose(payment)}>
                          {payment.reference}
                        </Button>
                      </TD>
                      <TD>{payment.beneficiary}</TD>
                      <TD textAlign="right" className={styles["PaymentTracker_figure"]}>
                        {PaymentTracker_money(payment.currency, payment.amount)}
                      </TD>
                      <TD>
                        <StackLayout gap={1}>
                          <Text>{payment.stage}</Text>
                          <Text styleAs="label" color="secondary">{`Stage ${STAGES.indexOf(payment.stage) + 1} of ${STAGES.length} · ${payment.rail}`}</Text>
                        </StackLayout>
                      </TD>
                      <TD>
                        <FlexLayout gap={1} align="center" wrap={false}>
                          <StatusIndicator status={PaymentTracker_TONE[status]} />
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

const StallAlerts_money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function StallAlerts_Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text className={styles["StallAlerts_figure"]}>{value}</Text>
    </StackLayout>
  );
}

function StallAlerts_EscalateForm({ payment, stall, escalated, onEscalate }: { payment: Payment; stall: Stall; escalated: string | undefined; onEscalate: (note: string) => void }) {
  const [note, setNote] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!escalated) onEscalate(note.trim());
  };

  return (
    <form onSubmit={submit} aria-labelledby="stall-alerts-action">
      <StackLayout gap={2}>
        <StackLayout gap={1}>
          <H3 id="stall-alerts-action">What to do</H3>
          <Text>{stall.action}</Text>
        </StackLayout>
        <FormField necessity="optional">
          <FormFieldLabel>Note for payment operations</FormFieldLabel>
          <MultilineInput value={note} textAreaProps={{ onChange: (event) => setNote(event.target.value) }} rows={3} readOnly={escalated !== undefined} />
          <FormFieldHelperText>{`Operations sees ${payment.reference}, its stage, and why it stalled.`}</FormFieldHelperText>
        </FormField>
        <FlexLayout gap={2} align="center" wrap>
          {escalated === undefined && (
            <Button type="submit" sentiment="accented">
              Escalate to operations
            </Button>
          )}
          <Text role="status" color="secondary">
            {escalated ?? ""}
          </Text>
        </FlexLayout>
      </StackLayout>
    </form>
  );
}

function StallAlerts() {
  const [id, setId] = useState(PAYMENTS[0]!.id);
  const [escalations, setEscalations] = useState<Record<string, string>>({});
  useBus("payment:selected", "stall-alerts", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && PAYMENTS.some((payment) => payment.id === next)) setId(next);
  });
  const payment = PAYMENTS.find((entry) => entry.id === id)!;
  const reached = STAGES.indexOf(payment.stage);

  const escalate = (note: string) =>
    setEscalations((current) => ({
      ...current,
      [payment.id]: `Escalated at 14:32 ET as case OPS-${7740 + Object.keys(current).length + 1}${note ? ", with your note" : ""}. Operations replies within 30 minutes.`,
    }));

  return (
    <Panel data-demo-anchor="stall-alerts-panel">
      <StackLayout gap={3}>
        <StackLayout gap={1}>
          <H2>{payment.reference}</H2>
          <Text color="secondary">{`${payment.beneficiary} · ${payment.account}`}</Text>
        </StackLayout>
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary">
            Amount
          </Text>
          <Display4 className={styles["StallAlerts_figure"]}>{StallAlerts_money(payment.currency, payment.amount)}</Display4>
        </StackLayout>
        <GridLayout columns={2} gap={2}>
          <StallAlerts_Figure label="Rail" value={payment.rail} />
          <StallAlerts_Figure label="Value date" value={payment.valueDate} />
        </GridLayout>
        <StackLayout gap={2} as="section" aria-labelledby="stall-alerts-progress">
          <H3 id="stall-alerts-progress">Where it is</H3>
          <Stepper orientation="vertical">
            {STAGES.map((stage, index) => {
              const done = index <= reached;
              const next = index === reached + 1;
              return (
                <Step
                  key={stage}
                  label={stage}
                  description={done ? `${STAGE_DETAIL[stage]}, ${payment.times[index]}` : next && payment.stall ? `Stalled since ${payment.stall.since}` : next ? "In progress" : "Not started"}
                  stage={done ? "completed" : next ? "active" : "pending"}
                  status={next && payment.stall ? "error" : undefined}
                />
              );
            })}
          </Stepper>
        </StackLayout>
        {payment.stall ? (
          <>
            <Banner status="warning">
              <BannerContent>
                <StackLayout gap={1}>
                  <Text fontWeight="bolder">{`Stalled since ${payment.stall.since}`}</Text>
                  <Text>{payment.stall.reason}</Text>
                </StackLayout>
              </BannerContent>
            </Banner>
            <StallAlerts_EscalateForm key={payment.id} payment={payment} stall={payment.stall} escalated={escalations[payment.id]} onEscalate={escalate} />
          </>
        ) : (
          <Text color="secondary">{payment.stage === "Settled" ? `Settled at ${payment.times[reached]}. Nothing to do.` : "On track for its value date. Nothing to do."}</Text>
        )}
      </StackLayout>
    </Panel>
  );
}

export default function PaymentStatusTracker() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <PaymentTracker />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <StallAlerts />
      </GridItem>
    </GridLayout>
  );
}
