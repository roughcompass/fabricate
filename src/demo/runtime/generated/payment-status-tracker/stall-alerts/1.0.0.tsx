import { useBus } from "@deweb/portal";
import { Banner, BannerContent, Button, Display4, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridLayout, H2, H3, MultilineInput, Panel, StackLayout, Step, Stepper, Text } from "@salt-ds/core";
import { type FormEvent, useState } from "react";
import { type Payment, PAYMENTS, STAGE_DETAIL, STAGES, type Stall } from "../data";
import styles from "./1.0.0.module.css";

const money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text className={styles.figure}>{value}</Text>
    </StackLayout>
  );
}

function EscalateForm({ payment, stall, escalated, onEscalate }: { payment: Payment; stall: Stall; escalated: string | undefined; onEscalate: (note: string) => void }) {
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

export default function StallAlerts() {
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
          <Display4 className={styles.figure}>{money(payment.currency, payment.amount)}</Display4>
        </StackLayout>
        <GridLayout columns={2} gap={2}>
          <Figure label="Rail" value={payment.rail} />
          <Figure label="Value date" value={payment.valueDate} />
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
            <EscalateForm key={payment.id} payment={payment} stall={payment.stall} escalated={escalations[payment.id]} onEscalate={escalate} />
          </>
        ) : (
          <Text color="secondary">{payment.stage === "Settled" ? `Settled at ${payment.times[reached]}. Nothing to do.` : "On track for its value date. Nothing to do."}</Text>
        )}
      </StackLayout>
    </Panel>
  );
}
