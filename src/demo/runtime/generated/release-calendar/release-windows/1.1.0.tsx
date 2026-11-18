import { usePublish } from "@deweb/portal";
import { Button, Dropdown, FlexLayout, FormField, FormFieldLabel, GridLayout, H2, H3, Input, Option, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { FREEZES, RELEASES, type ReleaseWindow, TEAMS, WEEKS, WINDOWS } from "../data";
import styles from "./1.1.0.module.css";

const STATUS = {
  open: { indicator: "success", label: "Open" },
  restricted: { indicator: "warning", label: "Restricted" },
  frozen: { indicator: "error", label: "Frozen" },
} as const;

const ALL_TEAMS = "All teams";

const freezesOf = (slot: ReleaseWindow) => FREEZES.filter((freeze) => slot.freezes.includes(freeze.id));
const statusOf = (slot: ReleaseWindow) => {
  const freezes = freezesOf(slot);
  return freezes.some((freeze) => freeze.kind === "full") ? "frozen" : freezes.length ? "restricted" : "open";
};

export default function ReleaseWindows() {
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState(ALL_TEAMS);
  const [selected, setSelected] = useState(WINDOWS[0]!.id);
  const publish = usePublish("release-windows");
  const search = query.trim().toLowerCase();
  const releasesOf = (slot: ReleaseWindow) => RELEASES.filter((release) => release.window === slot.id && (team === ALL_TEAMS || release.team === team));
  const matches = (slot: ReleaseWindow) =>
    (team === ALL_TEAMS || releasesOf(slot).length > 0) &&
    (!search || slot.date.toLowerCase().includes(search) || releasesOf(slot).some((release) => [release.name, release.team, release.change].some((field) => field.toLowerCase().includes(search))));
  const weeks = WEEKS.map((week) => ({ week, slots: WINDOWS.filter((slot) => slot.week === week.id && matches(slot)) })).filter((group) => group.slots.length > 0);

  const empty = search
    ? `No release windows match "${query.trim()}"${team === ALL_TEAMS ? "" : ` for ${team}`}. Clear the search${team === ALL_TEAMS ? "" : " or choose All teams"} to see more windows.`
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
            <Dropdown selected={[team]} onSelectionChange={(_event, next: string[]) => setTeam(next[0] ?? ALL_TEAMS)} data-demo-anchor="release-team">
              {[ALL_TEAMS, ...TEAMS].map((option) => (
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
                      <TH textAlign="right">{team === ALL_TEAMS ? "Releases" : `${team} releases`}</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {slots.map((slot) => {
                      const current = slot.id === selected;
                      const status = STATUS[statusOf(slot)];
                      const freezes = freezesOf(slot);
                      return (
                        <TR key={slot.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`window-${slot.id}`}>
                          <TD>
                            <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(slot)}>
                              {slot.day}
                            </Button>
                          </TD>
                          <TD className={styles.figure}>{slot.time}</TD>
                          <TD textAlign="right" className={styles.figure}>
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
