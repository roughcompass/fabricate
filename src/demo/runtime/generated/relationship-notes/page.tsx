// Relationship notes: the Relationships route as one page, composed from its microfrontends at their conformant versions:
// relationship-list 1.1.0 (main)
// meeting-notes 1.0.0 (side)
import { useBus, usePublish } from "@deweb/portal";
import { Avatar, Button, Checkbox, CheckboxGroup, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridItem, GridLayout, H2, H3, Input, MultilineInput, Panel, StackLayout, StatusIndicator, Table, TableContainer, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { FOLLOW_UPS, type FollowUp, type Note, NOTES, type Relationship, RELATIONSHIPS, TODAY } from "./data";
import styles from "./page.module.css";

const RelationshipList_FOLLOW_UP: Record<Relationship["followUp"]["status"], "error" | "warning" | "info"> = { Overdue: "error", "Due this week": "warning", Scheduled: "info" };

const RelationshipList_ago = (days: number) => (days === 0 ? "Today" : days === 1 ? "1 day ago" : `${days} days ago`);

function RelationshipList() {
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
                  <TH>Next follow-up</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((relationship) => {
                  const current = relationship.id === selected;
                  return (
                    <TR key={relationship.id} aria-current={current ? "true" : undefined} className={current ? styles["RelationshipList_selected"] : undefined} data-demo-anchor={`relationship-${relationship.id}`}>
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
                            {RelationshipList_ago(relationship.daysSince)}
                          </Text>
                        </StackLayout>
                      </TD>
                      <TD>
                        <StackLayout gap={1}>
                          <Text>{relationship.followUp.action}</Text>
                          <FlexLayout gap={1} align="center" wrap>
                            <StatusIndicator status={RelationshipList_FOLLOW_UP[relationship.followUp.status]} />
                            <Text styleAs="label">{`${relationship.followUp.status} · ${relationship.followUp.due}`}</Text>
                          </FlexLayout>
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

const MeetingNotes_NEXT_WEEK = "24 Nov 2026";

function MeetingNotes_Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text>{value}</Text>
    </StackLayout>
  );
}

function MeetingNotes_NoteForm({ relationship, onAdd }: { relationship: Relationship; onAdd: (text: string, followUp: string) => void }) {
  const [text, setText] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (text.trim() === "") {
      setInvalid(true);
      setMessage("");
      return;
    }
    onAdd(text.trim(), followUp.trim());
    setText("");
    setFollowUp("");
    setInvalid(false);
    setMessage(followUp.trim() ? `Note and follow-up added for ${relationship.client}.` : `Note added for ${relationship.client}.`);
  };

  return (
    <form onSubmit={submit} aria-labelledby="meeting-notes-form">
      <StackLayout gap={2}>
        <H3 id="meeting-notes-form">Add a note</H3>
        <FormField validationStatus={invalid ? "error" : undefined}>
          <FormFieldLabel>Note</FormFieldLabel>
          <MultilineInput value={text} textAreaProps={{ onChange: (event) => setText(event.target.value) }} rows={3} placeholder="What was discussed, and what the client asked for" />
          {invalid && <FormFieldHelperText>Write the note before adding it.</FormFieldHelperText>}
        </FormField>
        <FormField necessity="optional">
          <FormFieldLabel>Follow-up</FormFieldLabel>
          <Input value={followUp} onChange={(event: ChangeEvent<HTMLInputElement>) => setFollowUp(event.target.value)} placeholder="Send the term sheet" />
          <FormFieldHelperText>{`Assigned to you, due ${MeetingNotes_NEXT_WEEK}.`}</FormFieldHelperText>
        </FormField>
        <FlexLayout gap={2} align="center" wrap>
          <Button type="submit" sentiment="accented">
            Add note
          </Button>
          <Text role="status" color="secondary">
            {message}
          </Text>
        </FlexLayout>
      </StackLayout>
    </form>
  );
}

function MeetingNotes() {
  const [id, setId] = useState(RELATIONSHIPS[0]!.id);
  const [added, setAdded] = useState<Record<string, Note[]>>({});
  const [addedFollowUps, setAddedFollowUps] = useState<Record<string, FollowUp[]>>({});
  const [done, setDone] = useState<Record<string, string[]>>({});
  useBus("relationship:selected", "meeting-notes", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && RELATIONSHIPS.some((relationship) => relationship.id === next)) setId(next);
  });
  const relationship = RELATIONSHIPS.find((entry) => entry.id === id)!;
  const notes = [...(added[relationship.id] ?? []), ...(NOTES[relationship.id] ?? [])];
  const followUps = [...(addedFollowUps[relationship.id] ?? []), ...(FOLLOW_UPS[relationship.id] ?? [])];
  const checked = done[relationship.id] ?? followUps.filter((entry) => entry.done).map((entry) => entry.id);
  const open = followUps.filter((entry) => !checked.includes(entry.id)).length;

  const toggle = (event: ChangeEvent<HTMLInputElement>) => {
    const { value, checked: isChecked } = event.target;
    setDone((current) => ({ ...current, [relationship.id]: isChecked ? [...checked, value] : checked.filter((entry) => entry !== value) }));
  };

  const add = (text: string, followUp: string) => {
    setAdded((current) => {
      const own = current[relationship.id] ?? [];
      return { ...current, [relationship.id]: [{ id: `added-${own.length + 1}`, date: TODAY, author: "You", text }, ...own] };
    });
    if (followUp)
      setAddedFollowUps((current) => {
        const own = current[relationship.id] ?? [];
        return { ...current, [relationship.id]: [{ id: `added-${own.length + 1}`, action: followUp, owner: "You", due: MeetingNotes_NEXT_WEEK, done: false }, ...own] };
      });
  };

  return (
    <Panel data-demo-anchor="meeting-notes-panel">
      <StackLayout gap={3}>
        <StackLayout gap={1}>
          <H2>{relationship.client}</H2>
          <Text color="secondary">{`Covered by ${relationship.banker} · ${relationship.sector}`}</Text>
        </StackLayout>
        <GridLayout columns={2} gap={2}>
          <MeetingNotes_Figure label="Last meeting" value={relationship.lastMeeting} />
          <MeetingNotes_Figure label="Open follow-ups" value={String(open)} />
        </GridLayout>
        <StackLayout gap={2} as="section" aria-labelledby="meeting-notes-follow-ups">
          <H3 id="meeting-notes-follow-ups">Follow-ups</H3>
          {followUps.length === 0 ? (
            <Text color="secondary">No follow-ups yet. Add one with a note below.</Text>
          ) : (
            <FormField>
              <FormFieldLabel>Mark a follow-up done</FormFieldLabel>
              <CheckboxGroup checkedValues={checked} onChange={toggle}>
                {followUps.map((entry) => (
                  <Checkbox
                    key={entry.id}
                    value={entry.id}
                    label={
                      <StackLayout gap={1}>
                        <Text>{entry.action}</Text>
                        <Text styleAs="label" color="secondary">{`${checked.includes(entry.id) ? "Done" : `Due ${entry.due}`} · ${entry.owner}`}</Text>
                      </StackLayout>
                    }
                  />
                ))}
              </CheckboxGroup>
            </FormField>
          )}
        </StackLayout>
        <MeetingNotes_NoteForm key={relationship.id} relationship={relationship} onAdd={add} />
        <StackLayout gap={2} as="section" aria-labelledby="meeting-notes-list">
          <H3 id="meeting-notes-list">Notes</H3>
          {notes.length === 0 ? (
            <Text color="secondary">{`No notes for ${relationship.client} yet. Add the first one above.`}</Text>
          ) : (
            <StackLayout as="ol" gap={2} className={styles["MeetingNotes_list"]}>
              {notes.map((note) => (
                <StackLayout as="li" key={note.id} gap={1}>
                  <Text styleAs="label" color="secondary">{`${note.date} · ${note.author}`}</Text>
                  <Text>{note.text}</Text>
                </StackLayout>
              ))}
            </StackLayout>
          )}
        </StackLayout>
      </StackLayout>
    </Panel>
  );
}

export default function RelationshipNotes() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <RelationshipList />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <MeetingNotes />
      </GridItem>
    </GridLayout>
  );
}
