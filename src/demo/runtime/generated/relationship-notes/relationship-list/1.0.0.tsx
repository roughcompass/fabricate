import { usePublish } from "@deweb/portal";
import { Avatar, Button, FlexLayout, FormField, FormFieldLabel, H2, Input, Panel, StackLayout, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { type Relationship, RELATIONSHIPS, TODAY } from "../data";
import styles from "./1.0.0.module.css";

const ago = (days: number) => (days === 0 ? "Today" : days === 1 ? "1 day ago" : `${days} days ago`);

export default function RelationshipList() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(RELATIONSHIPS[0]!.id);
  const publish = usePublish("relationship-list");
  const search = query.trim().toLowerCase();
  const rows = RELATIONSHIPS.filter((entry) => [entry.client, entry.sector, entry.banker].some((field) => field.toLowerCase().includes(search)));

  const choose = (relationship: Relationship) => {
    setSelected(relationship.id);
    publish("relationship:selected", { id: relationship.id, name: relationship.client });
  };

  return (
    <Panel data-demo-anchor="relationship-list-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Client relationships</H2>
          <Text styleAs="label" color="secondary">{`${RELATIONSHIPS.length} clients, as of ${TODAY}`}</Text>
        </FlexLayout>
        <FormField>
          <FormFieldLabel>Find a client</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="Client, sector, or banker"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "relationship-search" }}
          />
        </FormField>
        {rows.length === 0 ? (
          <Text color="secondary">{`No clients match "${query.trim()}". Clear the search to see every relationship.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Client relationships">
              <THead sticky>
                <TR>
                  <TH>Client</TH>
                  <TH>Coverage banker</TH>
                  <TH>Last meeting</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((relationship) => {
                  const current = relationship.id === selected;
                  return (
                    <TR key={relationship.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`relationship-${relationship.id}`}>
                      <TD>
                        <StackLayout gap={1} align="start">
                          <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(relationship)}>
                            {relationship.client}
                          </Button>
                          <Text styleAs="label" color="secondary">
                            {relationship.sector}
                          </Text>
                        </StackLayout>
                      </TD>
                      <TD>
                        <FlexLayout gap={1} align="center" wrap={false}>
                          <Avatar name={relationship.banker} size={1} aria-hidden />
                          <Text>{relationship.banker}</Text>
                        </FlexLayout>
                      </TD>
                      <TD>
                        <StackLayout gap={1}>
                          <Text>{relationship.lastMeeting}</Text>
                          <Text styleAs="label" color="secondary">
                            {ago(relationship.daysSince)}
                          </Text>
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
