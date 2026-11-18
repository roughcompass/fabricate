import { useBus } from "@deweb/portal";
import { Button, Checkbox, CheckboxGroup, Display4, Dropdown, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridLayout, H2, H3, Input, Option, Panel, StackLayout, Text } from "@salt-ds/core";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { type DealDocument, DOCUMENTS, OPEN_ITEMS, type OpenItem, TEAM } from "../data";
import styles from "./1.0.0.module.css";

const DUE = "24 Nov 2026";

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

function RaiseForm({ doc, onRaise }: { doc: DealDocument; onRaise: (title: string, owner: string) => void }) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState<string>(doc.reviewer);
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (title.trim() === "") {
      setInvalid(true);
      setMessage("");
      return;
    }
    onRaise(title.trim(), owner);
    setTitle("");
    setInvalid(false);
    setMessage(`Item raised and assigned to ${owner}, due ${DUE}.`);
  };

  return (
    <form onSubmit={submit} aria-labelledby="open-items-form">
      <StackLayout gap={2}>
        <H3 id="open-items-form">Raise an item</H3>
        <FormField validationStatus={invalid ? "error" : undefined}>
          <FormFieldLabel>Item</FormFieldLabel>
          <Input value={title} onChange={(event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)} placeholder="What needs to change in this document" />
          {invalid && <FormFieldHelperText>Say what needs to change before raising the item.</FormFieldHelperText>}
        </FormField>
        <FormField>
          <FormFieldLabel>Owner</FormFieldLabel>
          <Dropdown value={owner} selected={[owner]} onSelectionChange={(_event, next: string[]) => setOwner(next[0] ?? owner)}>
            {TEAM.map((member) => (
              <Option key={member} value={member} />
            ))}
          </Dropdown>
          <FormFieldHelperText>{`Due ${DUE}. The deal team sees it straight away.`}</FormFieldHelperText>
        </FormField>
        <FlexLayout gap={2} align="center" wrap>
          <Button type="submit" sentiment="accented">
            Raise item
          </Button>
          <Text role="status" color="secondary">
            {message}
          </Text>
        </FlexLayout>
      </StackLayout>
    </form>
  );
}

export default function OpenItems() {
  const [id, setId] = useState(DOCUMENTS[0]!.id);
  const [raised, setRaised] = useState<Record<string, OpenItem[]>>({});
  const [resolved, setResolved] = useState<Record<string, string[]>>({});
  useBus("document:selected", "open-items", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && DOCUMENTS.some((doc) => doc.id === next)) setId(next);
  });
  const doc = DOCUMENTS.find((entry) => entry.id === id)!;
  const items = [...(OPEN_ITEMS[doc.id] ?? []), ...(raised[doc.id] ?? [])];
  const done = resolved[doc.id] ?? [];
  const open = items.filter((item) => !done.includes(item.id));

  const toggle = (event: ChangeEvent<HTMLInputElement>) => {
    const { value, checked } = event.target;
    setResolved((current) => ({ ...current, [doc.id]: checked ? [...done, value] : done.filter((entry) => entry !== value) }));
  };

  const raise = (title: string, owner: string) =>
    setRaised((current) => {
      const own = current[doc.id] ?? [];
      return { ...current, [doc.id]: [...own, { id: `raised-${own.length + 1}`, title, owner, due: DUE, raisedBy: "You" }] };
    });

  return (
    <Panel data-demo-anchor="open-items-panel">
      <StackLayout gap={3}>
        <StackLayout gap={1}>
          <H2>{doc.name}</H2>
          <Text color="secondary">{`${doc.folder} · ${doc.format} · ${doc.version}, updated ${doc.updated}`}</Text>
        </StackLayout>
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary">
            Open items
          </Text>
          <Display4 className={styles.figure}>{open.length}</Display4>
        </StackLayout>
        <GridLayout columns={2} gap={2}>
          <Figure label="Next due" value={open[0]?.due ?? "Nothing due"} />
          <Figure label="Reviewer" value={doc.reviewer} />
        </GridLayout>
        <StackLayout gap={2} as="section" aria-labelledby="open-items-list">
          <H3 id="open-items-list">Items</H3>
          {items.length === 0 ? (
            <Text color="secondary">{`No open items on the ${doc.name.charAt(0).toLowerCase()}${doc.name.slice(1)}. Raise one if something needs the deal team's attention.`}</Text>
          ) : (
            <FormField>
              <FormFieldLabel>Mark an item resolved</FormFieldLabel>
              <CheckboxGroup checkedValues={done} onChange={toggle}>
                {items.map((item) => (
                  <Checkbox
                    key={item.id}
                    value={item.id}
                    label={
                      <StackLayout gap={1}>
                        <Text>{item.title}</Text>
                        <Text styleAs="label" color="secondary">{`${item.owner} · ${done.includes(item.id) ? "Resolved" : `due ${item.due}`} · raised by ${item.raisedBy}`}</Text>
                      </StackLayout>
                    }
                  />
                ))}
              </CheckboxGroup>
            </FormField>
          )}
        </StackLayout>
        <RaiseForm key={doc.id} doc={doc} onRaise={raise} />
      </StackLayout>
    </Panel>
  );
}
