import { useBus } from "@deweb/portal";
import { Banner, BannerContent, Button, Display4, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, H2, H3, Input, LinearProgress, Panel, StackLayout, StatusIndicator, Text } from "@salt-ds/core";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { DESKS, type Desk, EVENTS, type LimitStatus, UPDATED, WARNING_AT } from "../data";
import styles from "./1.0.0.module.css";

const STATUS = {
  within: { indicator: "success", label: "Within limit" },
  warning: { indicator: "warning", label: "Warning" },
  breach: { indicator: "error", label: "Breach" },
} as const;

const usd = (value: number) => `USD ${value.toLocaleString("en-US")}k`;
const used = (desk: Desk) => Math.round((desk.usage / desk.limit) * 100);
const statusOf = (desk: Desk): LimitStatus => (desk.usage > desk.limit ? "breach" : used(desk) >= WARNING_AT ? "warning" : "within");

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

export default function LimitBreaches() {
  const [id, setId] = useState(DESKS[0]!.id);
  const [note, setNote] = useState("");
  const [escalated, setEscalated] = useState<Readonly<Record<string, string>>>({});
  useBus("desk:selected", "limit-breaches", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && DESKS.some((desk) => desk.id === next)) {
      setId(next);
      setNote("");
    }
  });
  const desk = DESKS.find((entry) => entry.id === id)!;
  const status = statusOf(desk);
  const events = EVENTS[desk.id] ?? [];
  const latest = events[0];
  const headroom = desk.limit - desk.usage;

  const escalate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEscalated({ ...escalated, [desk.id]: `Escalated to ${desk.head} at ${UPDATED}${note.trim() ? ", with your note" : ""}.` });
    setNote("");
  };

  return (
    <Panel data-demo-anchor="limit-breaches-panel">
      <StackLayout gap={2}>
        <StackLayout gap={1}>
          <H2>{desk.name}</H2>
          <Text color="secondary">{`${desk.measure}, desk head ${desk.head}`}</Text>
        </StackLayout>
        {status === "breach" && latest ? (
          <Banner status="error">
            <BannerContent>{`Over limit by ${usd(-headroom)} since ${latest.time}. Reduce the position or request a temporary increase.`}</BannerContent>
          </Banner>
        ) : null}
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary">
            Limit used
          </Text>
          <Display4 className={styles.figure}>{`${used(desk)}%`}</Display4>
          <LinearProgress className={styles.meter} value={Math.min(used(desk), 100)} hideLabel aria-label={`${desk.name} has used ${used(desk)}% of its limit`} />
          <FlexLayout gap={1} align="center">
            <StatusIndicator status={STATUS[status].indicator} />
            <Text>{STATUS[status].label}</Text>
          </FlexLayout>
        </StackLayout>
        <FlexLayout gap={3} wrap>
          <Figure label="Limit" value={usd(desk.limit)} />
          <Figure label="Usage" value={usd(desk.usage)} />
          <Figure label="Headroom" value={usd(headroom)} />
        </FlexLayout>
        <StackLayout gap={1}>
          <H3 id="limit-breaches-events">Breaches and warnings</H3>
          {events.length === 0 ? (
            <Text color="secondary">{`No breaches or warnings for ${desk.name} in the last 30 days.`}</Text>
          ) : (
            <StackLayout as="ul" gap={2} aria-labelledby="limit-breaches-events" className={styles.list}>
              {events.map((entry) => (
                <StackLayout as="li" key={entry.id} gap={1}>
                  <FlexLayout gap={1} align="center">
                    <StatusIndicator status={STATUS[entry.status].indicator} />
                    <Text fontWeight="bolder" className={styles.figure}>{`${STATUS[entry.status].label}, ${entry.usage}% of limit`}</Text>
                  </FlexLayout>
                  <Text styleAs="label" color="secondary">{`${entry.date}, ${entry.time}`}</Text>
                  <Text color="secondary">{entry.note}</Text>
                </StackLayout>
              ))}
            </StackLayout>
          )}
        </StackLayout>
        {status === "within" ? (
          <Text color="secondary">{`Nothing to escalate. ${desk.name} has ${usd(headroom)} of headroom.`}</Text>
        ) : (
          <form onSubmit={escalate}>
            <StackLayout gap={2}>
              <FormField>
                <FormFieldLabel>{`Note for ${desk.head}`}</FormFieldLabel>
                <Input value={note} onChange={(event: ChangeEvent<HTMLInputElement>) => setNote(event.target.value)} inputProps={{ "data-demo-anchor": "limit-escalation-note" }} />
                <FormFieldHelperText>Optional. Say what the desk is doing to reduce usage.</FormFieldHelperText>
              </FormField>
              <StackLayout gap={1} align="start">
                <Button type="submit" sentiment="accented">
                  Escalate to desk head
                </Button>
                <Text role="status" color="secondary">
                  {escalated[desk.id] ?? ""}
                </Text>
              </StackLayout>
            </StackLayout>
          </form>
        )}
      </StackLayout>
    </Panel>
  );
}
