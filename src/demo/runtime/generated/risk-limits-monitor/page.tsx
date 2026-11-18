// Risk limits monitor: the Limits route as one page, composed from its microfrontends at their conformant versions:
// desk-limits 1.1.0 (main)
// limit-breaches 1.0.0 (side)
import { useBus, usePublish } from "@deweb/portal";
import { Banner, BannerContent, Button, Display4, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridItem, GridLayout, H2, H3, Input, LinearProgress, Panel, StackLayout, StatusIndicator, Table, TableContainer, TBody, TD, Text, TH, THead, ToggleButton, ToggleButtonGroup, TR } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, type FormEvent, type SyntheticEvent, useState } from "react";
import { type Desk, DESKS, EVENTS, type LimitStatus, UPDATED, WARNING_AT } from "./data";
import styles from "./page.module.css";

const DeskLimits_STATUS = {
  within: { indicator: "success", label: "Within" },
  warning: { indicator: "warning", label: "Warning" },
  breach: { indicator: "error", label: "Breach" },
} as const;

const DeskLimits_amount = (value: number) => value.toLocaleString("en-US");

const DeskLimits_used = (desk: Desk) => Math.round((desk.usage / desk.limit) * 100);

const DeskLimits_statusOf = (desk: Desk): LimitStatus => (desk.usage > desk.limit ? "breach" : DeskLimits_used(desk) >= WARNING_AT ? "warning" : "within");

type DeskLimits_Filter = "all" | "breach" | "warning";

const DeskLimits_FILTERS: readonly { value: DeskLimits_Filter; label: string; empty: string }[] = [
  { value: "all", label: "All", empty: "desks" },
  { value: "breach", label: "Breaches", empty: "desks in breach" },
  { value: "warning", label: "Warnings", empty: "desks at warning" },
];

function DeskLimits() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DeskLimits_Filter>("all");
  const [selected, setSelected] = useState(DESKS[0]!.id);
  const publish = usePublish("desk-limits");
  const search = query.trim().toLowerCase();
  const matching = DESKS.filter((desk) => desk.name.toLowerCase().includes(search) || desk.measure.toLowerCase().includes(search));
  const rows = matching.filter((desk) => filter === "all" || DeskLimits_statusOf(desk) === filter);
  const count = (value: DeskLimits_Filter) => (value === "all" ? matching.length : matching.filter((desk) => DeskLimits_statusOf(desk) === value).length);
  const active = DeskLimits_FILTERS.find((entry) => entry.value === filter)!;
  const empty = search
    ? `No ${active.empty} match "${query.trim()}". Clear the search${filter === "all" ? "" : " or choose All"} to see more desks.`
    : `No ${active.empty} right now. Choose All to see every desk.`;

  const choose = (desk: Desk) => {
    setSelected(desk.id);
    publish("desk:selected", { id: desk.id, name: desk.name });
  };

  return (
    <Panel data-demo-anchor="desk-limits-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Desk limits</H2>
          <Text styleAs="label" color="secondary">{`USD thousands, updated ${UPDATED}`}</Text>
        </FlexLayout>
        <FormField>
          <FormFieldLabel>Find a desk</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="Desk or measure"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "desk-search" }}
          />
        </FormField>
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary" id="desk-limits-filter">
            Show
          </Text>
          <ToggleButtonGroup aria-labelledby="desk-limits-filter" value={filter} onChange={(event: SyntheticEvent<HTMLButtonElement>) => setFilter(event.currentTarget.value as DeskLimits_Filter)}>
            {DeskLimits_FILTERS.map((entry) => (
              <ToggleButton key={entry.value} value={entry.value} data-demo-anchor={`desk-filter-${entry.value}`}>
                {`${entry.label} (${count(entry.value)})`}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </StackLayout>
        {rows.length === 0 ? (
          <Text color="secondary">{empty}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Desk limits">
              <THead sticky>
                <TR>
                  <TH>Desk</TH>
                  <TH>Measure</TH>
                  <TH textAlign="right">Limit</TH>
                  <TH textAlign="right">Usage</TH>
                  <TH textAlign="right">Headroom</TH>
                  <TH>Used</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((desk) => {
                  const current = desk.id === selected;
                  const status = DeskLimits_STATUS[DeskLimits_statusOf(desk)];
                  const headroom = desk.limit - desk.usage;
                  return (
                    <TR key={desk.id} aria-current={current ? "true" : undefined} className={current ? styles["DeskLimits_selected"] : undefined} data-demo-anchor={`desk-${desk.id}`}>
                      <TD>
                        <Button sentiment="neutral" appearance="transparent" className={styles["DeskLimits_recordName"]} aria-pressed={current} onClick={() => choose(desk)}>
                          {desk.name}
                        </Button>
                      </TD>
                      <TD>{desk.measure}</TD>
                      <TD textAlign="right" className={styles["DeskLimits_figure"]}>
                        {DeskLimits_amount(desk.limit)}
                      </TD>
                      <TD textAlign="right" className={styles["DeskLimits_figure"]}>
                        {DeskLimits_amount(desk.usage)}
                      </TD>
                      <TD textAlign="right">
                        <Text color={headroom < 0 ? "error" : "primary"} className={styles["DeskLimits_figure"]}>
                          {DeskLimits_amount(headroom)}
                        </Text>
                      </TD>
                      <TD>
                        <StackLayout gap={1}>
                          <LinearProgress className={styles["DeskLimits_meter"]} value={Math.min(DeskLimits_used(desk), 100)} hideLabel aria-label={`${desk.name} has used ${DeskLimits_used(desk)}% of its limit`} />
                          <Text styleAs="label" color="secondary" className={styles["DeskLimits_figure"]}>{`${DeskLimits_used(desk)}%`}</Text>
                        </StackLayout>
                      </TD>
                      <TD>
                        <FlexLayout gap={1} align="center">
                          <StatusIndicator status={status.indicator} />
                          <Text>{status.label}</Text>
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

const LimitBreaches_STATUS = {
  within: { indicator: "success", label: "Within limit" },
  warning: { indicator: "warning", label: "Warning" },
  breach: { indicator: "error", label: "Breach" },
} as const;

const LimitBreaches_usd = (value: number) => `USD ${value.toLocaleString("en-US")}k`;

const LimitBreaches_used = (desk: Desk) => Math.round((desk.usage / desk.limit) * 100);

const LimitBreaches_statusOf = (desk: Desk): LimitStatus => (desk.usage > desk.limit ? "breach" : LimitBreaches_used(desk) >= WARNING_AT ? "warning" : "within");

function LimitBreaches_Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text className={styles["LimitBreaches_figure"]}>{value}</Text>
    </StackLayout>
  );
}

function LimitBreaches() {
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
  const status = LimitBreaches_statusOf(desk);
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
            <BannerContent>{`Over limit by ${LimitBreaches_usd(-headroom)} since ${latest.time}. Reduce the position or request a temporary increase.`}</BannerContent>
          </Banner>
        ) : null}
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary">
            Limit used
          </Text>
          <Display4 className={styles["LimitBreaches_figure"]}>{`${LimitBreaches_used(desk)}%`}</Display4>
          <LinearProgress className={styles["LimitBreaches_meter"]} value={Math.min(LimitBreaches_used(desk), 100)} hideLabel aria-label={`${desk.name} has used ${LimitBreaches_used(desk)}% of its limit`} />
          <FlexLayout gap={1} align="center">
            <StatusIndicator status={LimitBreaches_STATUS[status].indicator} />
            <Text>{LimitBreaches_STATUS[status].label}</Text>
          </FlexLayout>
        </StackLayout>
        <FlexLayout gap={3} wrap>
          <LimitBreaches_Figure label="Limit" value={LimitBreaches_usd(desk.limit)} />
          <LimitBreaches_Figure label="Usage" value={LimitBreaches_usd(desk.usage)} />
          <LimitBreaches_Figure label="Headroom" value={LimitBreaches_usd(headroom)} />
        </FlexLayout>
        <StackLayout gap={1}>
          <H3 id="limit-breaches-events">Breaches and warnings</H3>
          {events.length === 0 ? (
            <Text color="secondary">{`No breaches or warnings for ${desk.name} in the last 30 days.`}</Text>
          ) : (
            <StackLayout as="ul" gap={2} aria-labelledby="limit-breaches-events" className={styles["LimitBreaches_list"]}>
              {events.map((entry) => (
                <StackLayout as="li" key={entry.id} gap={1}>
                  <FlexLayout gap={1} align="center">
                    <StatusIndicator status={LimitBreaches_STATUS[entry.status].indicator} />
                    <Text fontWeight="bolder" className={styles["LimitBreaches_figure"]}>{`${LimitBreaches_STATUS[entry.status].label}, ${entry.usage}% of limit`}</Text>
                  </FlexLayout>
                  <Text styleAs="label" color="secondary">{`${entry.date}, ${entry.time}`}</Text>
                  <Text color="secondary">{entry.note}</Text>
                </StackLayout>
              ))}
            </StackLayout>
          )}
        </StackLayout>
        {status === "within" ? (
          <Text color="secondary">{`Nothing to escalate. ${desk.name} has ${LimitBreaches_usd(headroom)} of headroom.`}</Text>
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

export default function RiskLimitsMonitor() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <DeskLimits />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <LimitBreaches />
      </GridItem>
    </GridLayout>
  );
}
