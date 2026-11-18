import { useBus } from "@deweb/portal";
import { Avatar, Display4, FlexLayout, H2, H3, LinearProgress, Panel, StackLayout, Switch, Text } from "@salt-ds/core";
import { type ChangeEvent, useState } from "react";
import { ENVIRONMENTS, type Environment, FLAGS, type FlagState } from "../data";
import styles from "./1.0.0.module.css";

type States = Readonly<Record<string, Readonly<Record<Environment, FlagState>>>>;

const INITIAL: States = Object.fromEntries(FLAGS.map((flag) => [flag.id, flag.environments]));

const describe = (state: FlagState) => (!state.enabled ? `Off. Turning it on returns to ${state.rollout}% of users.` : state.rollout === 100 ? "On for every user." : `Rolling out to ${state.rollout}% of users.`);

export default function FlagEnvironments() {
  const [id, setId] = useState(FLAGS[0]!.id);
  const [states, setStates] = useState(INITIAL);
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
          <Display4 className={styles.figure}>{`${on} of ${ENVIRONMENTS.length}`}</Display4>
        </StackLayout>
        <StackLayout gap={1}>
          <H3 id="flag-environments-list">By environment</H3>
          <StackLayout as="ul" gap={2} aria-labelledby="flag-environments-list" className={styles.list}>
            {ENVIRONMENTS.map((environment) => {
              const state = current[environment.id];
              const reach = state.enabled ? state.rollout : 0;
              return (
                <StackLayout as="li" key={environment.id} gap={1} data-demo-anchor={`flag-env-${environment.id}`}>
                  <Switch label={environment.label} checked={state.enabled} onChange={toggle(environment.id, environment.label)} />
                  <LinearProgress className={styles.meter} value={reach} hideLabel aria-label={`${flag.name} reaches ${reach}% of ${environment.label.toLowerCase()} users`} />
                  <Text styleAs="label" color="secondary" className={styles.figure}>
                    {describe(state)}
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
