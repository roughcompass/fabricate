// Release calendar: the Releases route as one page, composed from its microfrontends at their conformant versions:
// release-windows 1.1.0 (main)
// freeze-periods 1.0.0 (side)
import { useBus, usePublish } from "@deweb/portal";
import { Banner, BannerContent, Button, Display4, Dropdown, FlexLayout, FormField, FormFieldLabel, GridItem, GridLayout, H2, H3, Input, Option, Panel, StackLayout, StatusIndicator, Table, TableContainer, Tag, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { FREEZES, RELEASES, type ReleaseWindow, TEAMS, WEEKS, WINDOWS } from "./data";
import styles from "./page.module.css";

const ReleaseWindows_STATUS = {
  open: { indicator: "success", label: "Open" },
  restricted: { indicator: "warning", label: "Restricted" },
  frozen: { indicator: "error", label: "Frozen" },
} as const;

const ReleaseWindows_ALL_TEAMS = "All teams";

const ReleaseWindows_freezesOf = (slot: ReleaseWindow) => FREEZES.filter((freeze) => slot.freezes.includes(freeze.id));

const ReleaseWindows_statusOf = (slot: ReleaseWindow) => {
  const freezes = ReleaseWindows_freezesOf(slot);
  return freezes.some((freeze) => freeze.kind === "full") ? "frozen" : freezes.length ? "restricted" : "open";
};

function ReleaseWindows() {
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState(ReleaseWindows_ALL_TEAMS);
  const [selected, setSelected] = useState(WINDOWS[0]!.id);
  const publish = usePublish("release-windows");
  const search = query.trim().toLowerCase();
  const releasesOf = (slot: ReleaseWindow) => RELEASES.filter((release) => release.window === slot.id && (team === ReleaseWindows_ALL_TEAMS || release.team === team));
  const matches = (slot: ReleaseWindow) =>
    (team === ReleaseWindows_ALL_TEAMS || releasesOf(slot).length > 0) &&
    (!search || slot.date.toLowerCase().includes(search) || releasesOf(slot).some((release) => [release.name, release.team, release.change].some((field) => field.toLowerCase().includes(search))));
  const weeks = WEEKS.map((week) => ({ week, slots: WINDOWS.filter((slot) => slot.week === week.id && matches(slot)) })).filter((group) => group.slots.length > 0);

  const empty = search
    ? `No release windows match "${query.trim()}"${team === ReleaseWindows_ALL_TEAMS ? "" : ` for ${team}`}. Clear the search${team === ReleaseWindows_ALL_TEAMS ? "" : " or choose All teams"} to see more windows.`
    : `${team} has no releases booked in these weeks. Choose All teams to see every window.`;

  const choose = (slot: ReleaseWindow) => {
    setSelected(slot.id);
    publish("release:selected", { id: slot.id, name: slot.date });
  };

  return (
    <Panel data-demo-anchor="release-windows-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Release windows</H2>
          <Text styleAs="label" color="secondary">{`${WEEKS[0]!.label} to ${WEEKS[WEEKS.length - 1]!.label}, times in ET`}</Text>
        </FlexLayout>
        <GridLayout columns={{ xs: 1, sm: 2 }} gap={2}>
          <FormField>
            <FormFieldLabel>Find a release</FormFieldLabel>
            <Input
              startAdornment={<SearchIcon aria-hidden />}
              placeholder="Release, team, or change number"
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
              inputProps={{ type: "search", "data-demo-anchor": "release-search" }}
            />
          </FormField>
          <FormField>
            <FormFieldLabel>Team</FormFieldLabel>
            <Dropdown selected={[team]} onSelectionChange={(_event, next: string[]) => setTeam(next[0] ?? ReleaseWindows_ALL_TEAMS)} data-demo-anchor="release-team">
              {[ReleaseWindows_ALL_TEAMS, ...TEAMS].map((option) => (
                <Option key={option} value={option}>
                  {option}
                </Option>
              ))}
            </Dropdown>
          </FormField>
        </GridLayout>
        {weeks.length === 0 ? (
          <Text color="secondary">{empty}</Text>
        ) : (
          weeks.map(({ week, slots }) => (
            <StackLayout as="section" key={week.id} gap={1} aria-labelledby={`release-week-${week.id}`}>
              <H3 id={`release-week-${week.id}`}>{`${week.label}, ${week.dates}`}</H3>
              <TableContainer>
                <Table aria-labelledby={`release-week-${week.id}`}>
                  <THead sticky>
                    <TR>
                      <TH>Window</TH>
                      <TH>Time</TH>
                      <TH textAlign="right">{team === ReleaseWindows_ALL_TEAMS ? "Releases" : `${team} releases`}</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {slots.map((slot) => {
                      const current = slot.id === selected;
                      const status = ReleaseWindows_STATUS[ReleaseWindows_statusOf(slot)];
                      const freezes = ReleaseWindows_freezesOf(slot);
                      return (
                        <TR key={slot.id} aria-current={current ? "true" : undefined} className={current ? styles["ReleaseWindows_selected"] : undefined} data-demo-anchor={`window-${slot.id}`}>
                          <TD>
                            <Button sentiment="neutral" appearance="transparent" className={styles["ReleaseWindows_recordName"]} aria-pressed={current} onClick={() => choose(slot)}>
                              {slot.day}
                            </Button>
                          </TD>
                          <TD className={styles["ReleaseWindows_figure"]}>{slot.time}</TD>
                          <TD textAlign="right" className={styles["ReleaseWindows_figure"]}>
                            {releasesOf(slot).length}
                          </TD>
                          <TD>
                            <StackLayout gap={0}>
                              <FlexLayout gap={1} align="center">
                                <StatusIndicator status={status.indicator} />
                                <Text>{status.label}</Text>
                              </FlexLayout>
                              {freezes.map((freeze) => (
                                <Text key={freeze.id} styleAs="label" color="secondary">
                                  {freeze.name}
                                </Text>
                              ))}
                            </StackLayout>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableContainer>
            </StackLayout>
          ))
        )}
      </StackLayout>
    </Panel>
  );
}

const FreezePeriods_WINDOW_STATUS = {
  open: { indicator: "success", label: "Open for releases" },
  restricted: { indicator: "warning", label: "Restricted by a partial freeze" },
  frozen: { indicator: "error", label: "Frozen" },
} as const;

const FreezePeriods_APPROVAL = {
  approved: { indicator: "success", label: "Approved" },
  pending: { indicator: "info", label: "Awaiting approval" },
  blocked: { indicator: "error", label: "Blocked by freeze" },
} as const;

function FreezePeriods_Figure({ label, value }: { label: string; value: number }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Display4 className={styles["FreezePeriods_figure"]}>{value}</Display4>
    </StackLayout>
  );
}

function FreezePeriods() {
  const [id, setId] = useState(WINDOWS[0]!.id);
  useBus("release:selected", "freeze-periods", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && WINDOWS.some((slot) => slot.id === next)) setId(next);
  });
  const slot = WINDOWS.find((entry) => entry.id === id)!;
  const week = WEEKS.find((entry) => entry.id === slot.week)!;
  const releases = RELEASES.filter((release) => release.window === slot.id);
  const freezes = FREEZES.filter((freeze) => slot.freezes.includes(freeze.id));
  const full = freezes.find((freeze) => freeze.kind === "full");
  const status = FreezePeriods_WINDOW_STATUS[full ? "frozen" : freezes.length ? "restricted" : "open"];

  return (
    <Panel data-demo-anchor="freeze-periods-panel">
      <StackLayout gap={2}>
        <StackLayout gap={1}>
          <H2>{slot.date}</H2>
          <Text color="secondary">{`${week.label}, ${slot.time}`}</Text>
          <FlexLayout gap={1} align="center">
            <StatusIndicator status={status.indicator} />
            <Text>{status.label}</Text>
          </FlexLayout>
        </StackLayout>
        {full ? (
          <Banner status="warning">
            <BannerContent>{`${full.name} covers this window. Only emergency changes approved by the change board can go ahead.`}</BannerContent>
          </Banner>
        ) : null}
        <GridLayout columns={3} gap={2}>
          <FreezePeriods_Figure label="Releases" value={releases.length} />
          <FreezePeriods_Figure label="Approved" value={releases.filter((release) => release.approval === "approved").length} />
          <FreezePeriods_Figure label="Blocked" value={releases.filter((release) => release.approval === "blocked").length} />
        </GridLayout>
        <StackLayout gap={1}>
          <H3 id="freeze-periods-releases">Releases</H3>
          {releases.length === 0 ? (
            <Text color="secondary">No releases are booked in this window.</Text>
          ) : (
            <StackLayout as="ul" gap={2} aria-labelledby="freeze-periods-releases" className={styles["FreezePeriods_list"]}>
              {releases.map((release) => (
                <StackLayout as="li" key={release.id} gap={1}>
                  <Text fontWeight="bolder">{release.name}</Text>
                  <Text styleAs="label" color="secondary">{`${release.team}, ${release.change}`}</Text>
                  <FlexLayout gap={1} align="center">
                    <StatusIndicator status={FreezePeriods_APPROVAL[release.approval].indicator} />
                    <Text>{FreezePeriods_APPROVAL[release.approval].label}</Text>
                  </FlexLayout>
                </StackLayout>
              ))}
            </StackLayout>
          )}
        </StackLayout>
        <StackLayout gap={1}>
          <H3 id="freeze-periods-freezes">Freezes affecting this window</H3>
          {freezes.length === 0 ? (
            <Text color="secondary">No freezes overlap this window, so every approved release can go ahead.</Text>
          ) : (
            <StackLayout as="ul" gap={2} aria-labelledby="freeze-periods-freezes" className={styles["FreezePeriods_list"]}>
              {freezes.map((freeze) => (
                <StackLayout as="li" key={freeze.id} gap={1}>
                  <FlexLayout gap={1} align="center" wrap>
                    <Text fontWeight="bolder">{freeze.name}</Text>
                    <Tag category={freeze.kind === "full" ? 5 : 3} variant="secondary">
                      {freeze.kind === "full" ? "Full freeze" : "Partial freeze"}
                    </Tag>
                  </FlexLayout>
                  <Text styleAs="label" color="secondary">{`${freeze.starts} to ${freeze.ends}`}</Text>
                  <Text color="secondary">{freeze.scope}</Text>
                </StackLayout>
              ))}
            </StackLayout>
          )}
        </StackLayout>
      </StackLayout>
    </Panel>
  );
}

export default function ReleaseCalendar() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <ReleaseWindows />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <FreezePeriods />
      </GridItem>
    </GridLayout>
  );
}
