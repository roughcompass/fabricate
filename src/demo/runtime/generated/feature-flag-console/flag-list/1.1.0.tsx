import { usePublish } from "@deweb/portal";
import { Avatar, Button, FlexLayout, FormField, FormFieldLabel, H2, Input, LinearProgress, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text, ToggleButton, ToggleButtonGroup } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, type SyntheticEvent, useState } from "react";
import { ENVIRONMENTS, type Environment, FLAGS, type Flag, type FlagState } from "../data";
import styles from "./1.1.0.module.css";

const rolloutOf = (state: FlagState) => (state.enabled ? state.rollout : 0);

function FlagStatus({ state }: { state: FlagState }) {
  if (!state.enabled) return <Text color="secondary">Off</Text>;
  return (
    <FlexLayout gap={1} align="center">
      <StatusIndicator status={state.rollout === 100 ? "success" : "info"} />
      <Text>{state.rollout === 100 ? "On" : "Rolling out"}</Text>
    </FlexLayout>
  );
}

export default function FlagList() {
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
                    <TR key={flag.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`flag-${flag.id}`}>
                      <TD>
                        <StackLayout gap={0} align="start">
                          <Button sentiment="neutral" appearance="transparent" className={styles.recordName} aria-pressed={current} onClick={() => choose(flag)}>
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
                        <FlagStatus state={state} />
                      </TD>
                      <TD>
                        <StackLayout gap={1}>
                          <LinearProgress className={styles.meter} value={rolloutOf(state)} hideLabel aria-label={`${flag.name} reaches ${rolloutOf(state)}% of ${where} users`} />
                          <Text styleAs="label" color="secondary" className={styles.figure}>{`${rolloutOf(state)}% of users`}</Text>
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
