import { useBus } from "@deweb/portal";
import { Avatar, Checkbox, CheckboxGroup, Divider, FlexLayout, GridLayout, H2, H3, LinearProgress, Panel, StackLayout, Tag, Text } from "@salt-ds/core";
import { type ChangeEvent, useState } from "react";
import { CHECKLISTS, PEOPLE } from "../data";
import styles from "./1.0.0.module.css";

/** Each joiner's completed tasks, starting from the checklist data. */
const INITIAL_DONE: Readonly<Record<string, readonly string[]>> = Object.fromEntries(Object.entries(CHECKLISTS).map(([id, tasks]) => [id, tasks.filter((task) => task.done).map((task) => task.id)]));

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text>{value}</Text>
    </StackLayout>
  );
}

export default function JoinerChecklist() {
  const [id, setId] = useState(PEOPLE[0]!.id);
  const [done, setDone] = useState(INITIAL_DONE);
  useBus("person:selected", "joiner-checklist", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && PEOPLE.some((person) => person.id === next)) setId(next);
  });
  const person = PEOPLE.find((entry) => entry.id === id)!;
  const tasks = CHECKLISTS[person.id] ?? [];
  const checked = done[person.id] ?? [];
  const progress = tasks.length ? Math.round((checked.length / tasks.length) * 100) : 0;
  const first = person.name.split(" ")[0];

  const toggle = (event: ChangeEvent<HTMLInputElement>) => {
    const task = event.target.value;
    setDone({ ...done, [person.id]: checked.includes(task) ? checked.filter((entry) => entry !== task) : [...checked, task] });
  };

  return (
    <Panel data-demo-anchor="joiner-checklist-panel">
      <StackLayout gap={2}>
        <FlexLayout gap={2} align="center">
          <Avatar name={person.name} size={2} aria-hidden />
          <StackLayout gap={1}>
            <H2>{person.name}</H2>
            <Text color="secondary">{`${person.role}, ${person.team}`}</Text>
          </StackLayout>
        </FlexLayout>
        <GridLayout columns={2} gap={2}>
          <Figure label="Location" value={`${person.location}, ${person.localTime}`} />
          <Figure label="Manager" value={person.manager} />
          <Figure label="Joined" value={person.joined} />
        </GridLayout>
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary">
            Skills
          </Text>
          <FlexLayout gap={1} wrap>
            {person.skills.map((skill) => (
              <Tag key={skill}>{skill}</Tag>
            ))}
          </FlexLayout>
        </StackLayout>
        <Divider />
        <StackLayout gap={2}>
          <H3 id="joiner-checklist-title">Onboarding checklist</H3>
          {person.joiner && tasks.length > 0 ? (
            <>
              <StackLayout gap={1}>
                <LinearProgress className={styles.meter} value={progress} aria-label={`${first}'s onboarding progress`} />
                <Text role="status" color="secondary">
                  {checked.length === tasks.length ? `All ${tasks.length} tasks done. ${first} has finished onboarding.` : `${checked.length} of ${tasks.length} tasks done.`}
                </Text>
              </StackLayout>
              <CheckboxGroup aria-labelledby="joiner-checklist-title" checkedValues={[...checked]} onChange={toggle} data-demo-anchor="joiner-tasks">
                {tasks.map((task) => (
                  <Checkbox key={task.id} value={task.id} label={`${task.label}, due ${task.due}`} />
                ))}
              </CheckboxGroup>
            </>
          ) : (
            <Text color="secondary">{`Checklists are for colleagues who joined in the last 90 days. ${first} joined on ${person.joined}.`}</Text>
          )}
        </StackLayout>
      </StackLayout>
    </Panel>
  );
}
