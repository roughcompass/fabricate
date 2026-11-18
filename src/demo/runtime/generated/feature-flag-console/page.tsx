// Feature flag console: the Flags route as one page, composed from its microfrontends at their conformant versions:
// flag-list 1.1.0 (main)
// flag-environments 1.0.0 (side)
import { useBus, usePublish } from "@deweb/portal";
import { Avatar, Button, Display4, FlexLayout, FormField, FormFieldLabel, GridItem, GridLayout, H2, H3, Input, LinearProgress, Panel, StackLayout, StatusIndicator, Switch, Table, TableContainer, TBody, TD, Text, TH, THead, ToggleButton, ToggleButtonGroup, TR } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, type SyntheticEvent, useState } from "react";
import { type Environment, ENVIRONMENTS, type Flag, FLAGS, type FlagState } from "./data";
import styles from "./page.module.css";

const FlagList_rolloutOf = (state: FlagState) => (state.enabled ? state.rollout : 0);

function FlagList_FlagStatus({ state }: { state: FlagState }) {
  if (!state.enabled) return <Text color="secondary">Off</Text>;
  return (
    <FlexLayout gap={1} align="center">
      <StatusIndicator status={state.rollout === 100 ? "success" : "info"} />
      <Text>{state.rollout === 100 ? "On" : "Rolling out"}</Text>
    </FlexLayout>
  );
}

function FlagList() {
  const [query, setQuery] = useState("");
  const [environment, setEnvironment] = useState<Environment>("production");
  const [selected, setSelected] = useState(FLAGS[0]!.id);
  const publish = usePublish("flag-list");
  const search = query.trim().toLowerCase();
  const rows = FLAGS.filter((flag) => [flag.name, flag.key, flag.owner].some((field) => field.toLowerCase().includes(search)));
  const label = ENVIRONMENTS.find((entry) => entry.id === environment)!.label;
  const where = label.toLowerCase();

  const choose = (flag: Flag) => {
    setSelected(flag.id);
    publish("flag:selected", { id: flag.id, name: flag.name });
  };

  return (
    <Panel data-demo-anchor="flag-list-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Feature flags</H2>
          <Text styleAs="label" color="secondary">{`${FLAGS.filter((flag) => flag.environments[environment].enabled).length} of ${FLAGS.length} on in ${where}`}</Text>
        </FlexLayout>
        <FormField>
          <FormFieldLabel>Find a flag</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="Name, key, or owner"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "flag-search" }}
          />
        </FormField>
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary" id="flag-list-environment">
            Environment
          </Text>
          <ToggleButtonGroup aria-labelledby="flag-list-environment" value={environment} onChange={(event: SyntheticEvent<HTMLButtonElement>) => setEnvironment(event.currentTarget.value as Environment)}>
            {ENVIRONMENTS.map((entry) => (
              <ToggleButton key={entry.id} value={entry.id} data-demo-anchor={`flag-environment-${entry.id}`}>
                {entry.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </StackLayout>
        {rows.length === 0 ? (
          <Text color="secondary">{`No flags match "${query.trim()}". Clear the search to see every flag.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label={`Feature flags in ${where}`}>
              <THead sticky>
                <TR>
                  <TH>Flag</TH>
                  <TH>Owner</TH>
                  <TH>{`Status in ${where}`}</TH>
                  <TH>{`Rollout in ${where}`}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((flag) => {
                  const current = flag.id === selected;
                  const state = flag.environments[environment];
                  return (
                    <TR key={flag.id} aria-current={current ? "true" : undefined} className={current ? styles["FlagList_selected"] : undefined} data-demo-anchor={`flag-${flag.id}`}>
                      <TD>
                        <StackLayout gap={0} align="start">
                          <Button sentiment="neutral" appearance="transparent" className={styles["FlagList_recordName"]} aria-pressed={current} onClick={() => choose(flag)}>
                            {flag.name}
                          </Button>
                          <Text styleAs="code" color="secondary">
                            {flag.key}
                          </Text>
                        </StackLayout>
                      </TD>
                      <TD>
                        <FlexLayout gap={1} align="center">
                          <Avatar name={flag.owner} size={0.75} aria-hidden />
                          <Text>{flag.owner}</Text>
                        </FlexLayout>
                      </TD>
                      <TD>
                        <FlagList_FlagStatus state={state} />
                      </TD>
                      <TD>
                        <StackLayout gap={1}>
                          <LinearProgress className={styles["FlagList_meter"]} value={FlagList_rolloutOf(state)} hideLabel aria-label={`${flag.name} reaches ${FlagList_rolloutOf(state)}% of ${where} users`} />
                          <Text styleAs="label" color="secondary" className={styles["FlagList_figure"]}>{`${FlagList_rolloutOf(state)}% of users`}</Text>
                        </StackLayout>
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

type FlagEnvironments_States = Readonly<Record<string, Readonly<Record<Environment, FlagState>>>>;

const FlagEnvironments_INITIAL: FlagEnvironments_States = Object.fromEntries(FLAGS.map((flag) => [flag.id, flag.environments]));

const FlagEnvironments_describe = (state: FlagState) => (!state.enabled ? `Off. Turning it on returns to ${state.rollout}% of users.` : state.rollout === 100 ? "On for every user." : `Rolling out to ${state.rollout}% of users.`);

function FlagEnvironments() {
  const [id, setId] = useState(FLAGS[0]!.id);
  const [states, setStates] = useState(FlagEnvironments_INITIAL);
  const [message, setMessage] = useState("");
  useBus("flag:selected", "flag-environments", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && FLAGS.some((flag) => flag.id === next)) {
      setId(next);
      setMessage("");
    }
  });
  const flag = FLAGS.find((entry) => entry.id === id)!;
  const current = states[flag.id] ?? flag.environments;
  const on = ENVIRONMENTS.filter((environment) => current[environment.id].enabled).length;

  const toggle = (environment: Environment, label: string) => (event: ChangeEvent<HTMLInputElement>) => {
    const enabled = event.target.checked;
    setStates({ ...states, [flag.id]: { ...current, [environment]: { ...current[environment], enabled } } });
    setMessage(`${flag.name} turned ${enabled ? "on" : "off"} in ${label.toLowerCase()}.`);
  };

  return (
    <Panel data-demo-anchor="flag-environments-panel">
      <StackLayout gap={2}>
        <StackLayout gap={1}>
          <H2>{flag.name}</H2>
          <Text styleAs="code" color="secondary">
            {flag.key}
          </Text>
          <Text color="secondary">{flag.description}</Text>
        </StackLayout>
        <FlexLayout gap={1} align="center">
          <Avatar name={flag.owner} size={0.75} aria-hidden />
          <Text>{`${flag.owner}, ${flag.team}`}</Text>
        </FlexLayout>
        <Text styleAs="label" color="secondary">{`Updated ${flag.updated}`}</Text>
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary">
            Environments on
          </Text>
          <Display4 className={styles["FlagEnvironments_figure"]}>{`${on} of ${ENVIRONMENTS.length}`}</Display4>
        </StackLayout>
        <StackLayout gap={1}>
          <H3 id="flag-environments-list">By environment</H3>
          <StackLayout as="ul" gap={2} aria-labelledby="flag-environments-list" className={styles["FlagEnvironments_list"]}>
            {ENVIRONMENTS.map((environment) => {
              const state = current[environment.id];
              const reach = state.enabled ? state.rollout : 0;
              return (
                <StackLayout as="li" key={environment.id} gap={1} data-demo-anchor={`flag-env-${environment.id}`}>
                  <Switch label={environment.label} checked={state.enabled} onChange={toggle(environment.id, environment.label)} />
                  <LinearProgress className={styles["FlagEnvironments_meter"]} value={reach} hideLabel aria-label={`${flag.name} reaches ${reach}% of ${environment.label.toLowerCase()} users`} />
                  <Text styleAs="label" color="secondary" className={styles["FlagEnvironments_figure"]}>
                    {FlagEnvironments_describe(state)}
                  </Text>
                </StackLayout>
              );
            })}
          </StackLayout>
        </StackLayout>
        <Text role="status" color="secondary">
          {message}
        </Text>
      </StackLayout>
    </Panel>
  );
}

export default function FeatureFlagConsole() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <FlagList />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <FlagEnvironments />
      </GridItem>
    </GridLayout>
  );
}
