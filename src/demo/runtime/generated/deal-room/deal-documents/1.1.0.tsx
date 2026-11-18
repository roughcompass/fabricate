import { usePublish } from "@deweb/portal";
import { Avatar, Button, FlexLayout, FormField, FormFieldLabel, H2, Input, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { DEAL, type DealDocument, DOCUMENTS, FOLDERS, OPEN_ITEMS } from "../data";
import styles from "./1.1.0.module.css";

const COLUMNS = 5;
const REVIEW: Record<DealDocument["review"], "success" | "info" | "warning"> = { Approved: "success", "In review": "info", "Changes requested": "warning" };

export default function DealDocuments() {
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
                  <TR className={styles.group}>
                    <TH scope="rowgroup" colSpan={COLUMNS}>
                      <FlexLayout gap={1} align="baseline">
                        <Text fontWeight="bolder">{folder}</Text>
                        <Text styleAs="label" color="secondary">{`${documents.length} ${documents.length === 1 ? "document" : "documents"}`}</Text>
                      </FlexLayout>
                    </TH>
                  </TR>
                  {documents.map((doc) => {
                    const current = doc.id === selected;
                    return (
                      <TR key={doc.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`document-${doc.id}`}>
                        <TD>
                          <StackLayout gap={1} align="start">
                            <Button sentiment="neutral" appearance="transparent" className={styles.recordName} aria-pressed={current} onClick={() => choose(doc)}>
                              {doc.name}
                            </Button>
                            <Text styleAs="label" color="secondary">
                              {doc.format}
                            </Text>
                          </StackLayout>
                        </TD>
                        <TD className={styles.figure}>{doc.version}</TD>
                        <TD>
                          <FlexLayout gap={1} align="center" wrap={false}>
                            <Avatar name={doc.reviewer} size={1} aria-hidden />
                            <StackLayout gap={1}>
                              <Text>{doc.reviewer}</Text>
                              <FlexLayout gap={1} align="center" wrap={false}>
                                <StatusIndicator status={REVIEW[doc.review]} />
                                <Text styleAs="label">{doc.review}</Text>
                              </FlexLayout>
                            </StackLayout>
                          </FlexLayout>
                        </TD>
                        <TD>{doc.updated}</TD>
                        <TD textAlign="right" className={styles.figure}>
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
