// Team directory: the People route as one page, composed from its microfrontends at their conformant versions:
// people-search 1.1.0 (main)
// joiner-checklist 1.0.0 (side)
import { useBus, usePublish } from "@deweb/portal";
import { Avatar, Button, Checkbox, CheckboxGroup, Divider, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridItem, GridLayout, H2, H3, Input, LinearProgress, Panel, StackLayout, Table, TableContainer, Tag, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { CHECKLISTS, PEOPLE, type Person, SKILLS } from "./data";
import styles from "./page.module.css";

const PeopleSearch_list = (items: readonly string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

function PeopleSearch() {
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState(PEOPLE[0]!.id);
  const publish = usePublish("people-search");
  const search = query.trim().toLowerCase();
  const rows = PEOPLE.filter(
    (person) => [person.name, person.team, person.location].some((field) => field.toLowerCase().includes(search)) && skills.every((skill) => person.skills.includes(skill)),
  );

  const choose = (person: Person) => {
    setSelected(person.id);
    publish("person:selected", { id: person.id, name: person.name });
  };

  const toggleSkill = (event: ChangeEvent<HTMLInputElement>) => {
    const skill = event.target.value;
    setSkills(skills.includes(skill) ? skills.filter((entry) => entry !== skill) : [...skills, skill]);
  };

  const empty = search
    ? `No colleagues match "${query.trim()}"${skills.length ? ` with ${PeopleSearch_list(skills)}` : ""}. Clear the search${skills.length ? " or uncheck a skill" : ""} to see more people.`
    : `No colleagues have ${PeopleSearch_list(skills)}. Uncheck a skill to see more people.`;

  return (
    <Panel data-demo-anchor="people-search-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>People</H2>
          <Text styleAs="label" color="secondary">{`${PEOPLE.length} colleagues, ${PEOPLE.filter((person) => person.joiner).length} new joiners`}</Text>
        </FlexLayout>
        <FormField>
          <FormFieldLabel>Find a colleague</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="Name, team, or location"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "person-search" }}
          />
        </FormField>
        <FormField>
          <FormFieldLabel>Skills</FormFieldLabel>
          <CheckboxGroup direction="horizontal" checkedValues={[...skills]} onChange={toggleSkill} data-demo-anchor="person-skills">
            {SKILLS.map((skill) => (
              <Checkbox key={skill} value={skill} label={skill} />
            ))}
          </CheckboxGroup>
          <FormFieldHelperText>Shows colleagues with every skill you check.</FormFieldHelperText>
        </FormField>
        {rows.length === 0 ? (
          <Text color="secondary">{empty}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Colleagues">
              <THead sticky>
                <TR>
                  <TH>Name</TH>
                  <TH>Role</TH>
                  <TH>Team</TH>
                  <TH>Location</TH>
                  <TH>Skills</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((person) => {
                  const current = person.id === selected;
                  return (
                    <TR key={person.id} aria-current={current ? "true" : undefined} className={current ? styles["PeopleSearch_selected"] : undefined} data-demo-anchor={`person-${person.id}`}>
                      <TD>
                        <FlexLayout gap={1} align="center">
                          <Avatar name={person.name} aria-hidden />
                          <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(person)}>
                            {person.name}
                          </Button>
                          {person.joiner ? (
                            <Tag category={3} variant="secondary">
                              New joiner
                            </Tag>
                          ) : null}
                        </FlexLayout>
                      </TD>
                      <TD>{person.role}</TD>
                      <TD>{person.team}</TD>
                      <TD>{person.location}</TD>
                      <TD>
                        <FlexLayout gap={1} wrap>
                          {person.skills.map((skill) => (
                            <Tag key={skill} bordered={skills.includes(skill)}>
                              {skill}
                            </Tag>
                          ))}
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

const JoinerChecklist_INITIAL_DONE: Readonly<Record<string, readonly string[]>> = Object.fromEntries(Object.entries(CHECKLISTS).map(([id, tasks]) => [id, tasks.filter((task) => task.done).map((task) => task.id)]));

function JoinerChecklist_Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text>{value}</Text>
    </StackLayout>
  );
}

function JoinerChecklist() {
  const [id, setId] = useState(PEOPLE[0]!.id);
  const [done, setDone] = useState(JoinerChecklist_INITIAL_DONE);
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
          <JoinerChecklist_Figure label="Location" value={`${person.location}, ${person.localTime}`} />
          <JoinerChecklist_Figure label="Manager" value={person.manager} />
          <JoinerChecklist_Figure label="Joined" value={person.joined} />
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
                <LinearProgress className={styles["JoinerChecklist_meter"]} value={progress} aria-label={`${first}'s onboarding progress`} />
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

export default function TeamDirectory() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <PeopleSearch />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <JoinerChecklist />
      </GridItem>
    </GridLayout>
  );
}
