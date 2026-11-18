// Deal room: the Documents route as one page, composed from its microfrontends at their conformant versions:
// deal-documents 1.1.0 (main)
// open-items 1.0.0 (side)
import { useBus, usePublish } from "@deweb/portal";
import { Avatar, Button, Checkbox, CheckboxGroup, Display4, Dropdown, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridItem, GridLayout, H2, H3, Input, Option, Panel, StackLayout, StatusIndicator, Table, TableContainer, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { DEAL, type DealDocument, DOCUMENTS, FOLDERS, OPEN_ITEMS, type OpenItem, TEAM } from "./data";
import styles from "./page.module.css";

const DealDocuments_COLUMNS = 5;

const DealDocuments_REVIEW: Record<DealDocument["review"], "success" | "info" | "warning"> = { Approved: "success", "In review": "info", "Changes requested": "warning" };

function DealDocuments() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(DOCUMENTS[0]!.id);
  const publish = usePublish("deal-documents");
  const search = query.trim().toLowerCase();
  const rows = DOCUMENTS.filter((doc) => doc.name.toLowerCase().includes(search) || doc.folder.toLowerCase().includes(search));
  const groups = FOLDERS.map((folder) => ({ folder, documents: rows.filter((doc) => doc.folder === folder) })).filter((group) => group.documents.length > 0);

  const choose = (doc: DealDocument) => {
    setSelected(doc.id);
    publish("document:selected", { id: doc.id, name: doc.name });
  };

  return (
    <Panel data-demo-anchor="deal-documents-panel">
      <StackLayout gap={2}>
        <StackLayout gap={1}>
          <H2>Deal documents</H2>
          <Text styleAs="label" color="secondary">
            {DEAL}
          </Text>
        </StackLayout>
        <FormField>
          <FormFieldLabel>Find a doc</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="Document or folder name"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "document-search" }}
          />
        </FormField>
        {groups.length === 0 ? (
          <Text color="secondary">{`No documents match "${query.trim()}". Clear the search to see every folder.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Deal documents by folder">
              <THead sticky>
                <TR>
                  <TH>Document</TH>
                  <TH>Version</TH>
                  <TH>Reviewer</TH>
                  <TH>Updated</TH>
                  <TH textAlign="right">Open items</TH>
                </TR>
              </THead>
              {groups.map(({ folder, documents }) => (
                <TBody key={folder}>
                  <TR className={styles["DealDocuments_group"]}>
                    <TH scope="rowgroup" colSpan={DealDocuments_COLUMNS}>
                      <FlexLayout gap={1} align="baseline">
                        <Text fontWeight="bolder">{folder}</Text>
                        <Text styleAs="label" color="secondary">{`${documents.length} ${documents.length === 1 ? "document" : "documents"}`}</Text>
                      </FlexLayout>
                    </TH>
                  </TR>
                  {documents.map((doc) => {
                    const current = doc.id === selected;
                    return (
                      <TR key={doc.id} aria-current={current ? "true" : undefined} className={current ? styles["DealDocuments_selected"] : undefined} data-demo-anchor={`document-${doc.id}`}>
                        <TD>
                          <StackLayout gap={1} align="start">
                            <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(doc)}>
                              {doc.name}
                            </Button>
                            <Text styleAs="label" color="secondary">
                              {doc.format}
                            </Text>
                          </StackLayout>
                        </TD>
                        <TD className={styles["DealDocuments_figure"]}>{doc.version}</TD>
                        <TD>
                          <FlexLayout gap={1} align="center" wrap={false}>
                            <Avatar name={doc.reviewer} size={1} aria-hidden />
                            <StackLayout gap={1}>
                              <Text>{doc.reviewer}</Text>
                              <FlexLayout gap={1} align="center" wrap={false}>
                                <StatusIndicator status={DealDocuments_REVIEW[doc.review]} />
                                <Text styleAs="label">{doc.review}</Text>
                              </FlexLayout>
                            </StackLayout>
                          </FlexLayout>
                        </TD>
                        <TD>{doc.updated}</TD>
                        <TD textAlign="right" className={styles["DealDocuments_figure"]}>
                          {(OPEN_ITEMS[doc.id] ?? []).length}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              ))}
            </Table>
          </TableContainer>
        )}
      </StackLayout>
    </Panel>
  );
}

const OpenItems_DUE = "24 Nov 2026";

function OpenItems_Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text>{value}</Text>
    </StackLayout>
  );
}

function OpenItems_RaiseForm({ doc, onRaise }: { doc: DealDocument; onRaise: (title: string, owner: string) => void }) {
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
    setMessage(`Item raised and assigned to ${owner}, due ${OpenItems_DUE}.`);
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
          <FormFieldHelperText>{`Due ${OpenItems_DUE}. The deal team sees it straight away.`}</FormFieldHelperText>
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

function OpenItems() {
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
      return { ...current, [doc.id]: [...own, { id: `raised-${own.length + 1}`, title, owner, due: OpenItems_DUE, raisedBy: "You" }] };
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
          <Display4 className={styles["OpenItems_figure"]}>{open.length}</Display4>
        </StackLayout>
        <GridLayout columns={2} gap={2}>
          <OpenItems_Figure label="Next due" value={open[0]?.due ?? "Nothing due"} />
          <OpenItems_Figure label="Reviewer" value={doc.reviewer} />
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
        <OpenItems_RaiseForm key={doc.id} doc={doc} onRaise={raise} />
      </StackLayout>
    </Panel>
  );
}

export default function DealRoom() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <DealDocuments />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <OpenItems />
      </GridItem>
    </GridLayout>
  );
}
