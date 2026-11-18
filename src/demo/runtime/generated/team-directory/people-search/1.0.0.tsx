import { usePublish } from "@deweb/portal";
import { Avatar, Button, FlexLayout, FormField, FormFieldLabel, H2, Input, Panel, StackLayout, TBody, TD, TH, THead, TR, Table, TableContainer, Tag, Text } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { PEOPLE, type Person } from "../data";
import styles from "./1.0.0.module.css";

export default function PeopleSearch() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(PEOPLE[0]!.id);
  const publish = usePublish("people-search");
  const search = query.trim().toLowerCase();
  const rows = PEOPLE.filter((person) => [person.name, person.team, person.location].some((field) => field.toLowerCase().includes(search)));

  const choose = (person: Person) => {
    setSelected(person.id);
    publish("person:selected", { id: person.id, name: person.name });
  };

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
        {rows.length === 0 ? (
          <Text color="secondary">{`No colleagues match "${query.trim()}". Clear the search to see everyone.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Colleagues">
              <THead sticky>
                <TR>
                  <TH>Name</TH>
                  <TH>Role</TH>
                  <TH>Team</TH>
                  <TH>Location</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((person) => {
                  const current = person.id === selected;
                  return (
                    <TR key={person.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`person-${person.id}`}>
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
