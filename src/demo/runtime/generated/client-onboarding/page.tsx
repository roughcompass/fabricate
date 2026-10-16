// Client onboarding: the Clients route as one page, composed from its microfrontends at their conformant versions:
// client-search 4.2.0 (main)
// kyc-checklist 3.3.0 (side)
// document-review 1.6.0 (wide)
import { planted, useBus, useProfile, usePublish } from "@deweb/portal";
import { Button, Card, Divider, FlexLayout, FlowLayout, FormField, FormFieldLabel, GridItem, GridLayout, H2, Input, MultilineInput, Panel, StackLayout, StatusIndicator, Table, TableContainer, TBody, TD, Text, TH, THead, ToggleButton, TR } from "@salt-ds/core";
import { CheckmarkIcon } from "@salt-ds/icons";
import { useState } from "react";
import { CHECKS, type Client, CLIENTS, DOCUMENTS } from "./data";

const ClientSearch_SEGMENTS = ["All", "Corporate", "Commercial", "Financial institution"];

function ClientSearch() {
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState("All");
  const [selected, setSelected] = useState(CLIENTS[0]!.id);
  const publish = usePublish("client-search");
  const rows = CLIENTS.filter(
    (entry) =>
      entry.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (segment === "All" || entry.segment === segment),
  );

  return (
    <Panel data-demo-anchor="client-panel">
      <StackLayout gap={2}>
        <H2>Clients</H2>
        <FormField>
          <FormFieldLabel>Search clients</FormFieldLabel>
          <Input
            placeholder="Client name"
            value={query}
            onChange={(event) => setQuery((event.target as HTMLInputElement).value)}
            inputProps={{
              id: "client-query",
              type: "search",
              "data-demo-anchor": "client-search",
            }}
          />
        </FormField>
        <FlowLayout gap={1} role="group" aria-label="Segment">
          {ClientSearch_SEGMENTS.map((option) => (
            <ToggleButton
              key={option}
              value={option}
              selected={segment === option}
              onChange={() => setSegment(option)}
              data-demo-anchor={`segment-${option}`}
            >
              {option}
            </ToggleButton>
          ))}
        </FlowLayout>
        <StackLayout
          as="ul"
          gap={1}
          aria-label="Recently viewed clients"
          style={{ listStyle: "none", padding: 0, margin: 0 }}
        >
          {rows.map((entry) => (
            <li key={entry.id} style={{ display: "grid" }}>
              <ToggleButton
                value={entry.id}
                selected={selected === entry.id}
                onChange={() => {
                  setSelected(entry.id);
                  publish("client:selected", { id: entry.id, name: entry.name });
                }}
                data-demo-anchor={`client-${entry.id}`}
                style={{
                  height: "auto",
                  justifyContent: "space-between",
                  padding: "var(--salt-spacing-100)",
                  gap: "var(--salt-spacing-200)",
                  textAlign: "left",
                }}
              >
                <StackLayout gap={0} align="start">
                  <Text styleAs="label">
                    <strong>{entry.name}</strong>
                  </Text>
                  <Text color="inherit">{`${entry.segment} · ${entry.country}`}</Text>
                </StackLayout>
                <FlexLayout gap={1} align="center">
                  <StatusIndicator status={entry.stage === "Approved" ? "success" : "info"} />
                  <Text>{entry.stage}</Text>
                </FlexLayout>
              </ToggleButton>
            </li>
          ))}
        </StackLayout>
      </StackLayout>
    </Panel>
  );
}

const KycChecklist_findClient = (id: string) => CLIENTS.find((entry) => entry.id === id);

function KycChecklist_useSelectedClient(): Client {
  const [id, setId] = useState<string>(CLIENTS[0]!.id);
  useBus("client:selected", "kyc-checklist", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && KycChecklist_findClient(next)) setId(next);
  });
  return KycChecklist_findClient(id)!;
}

function KycChecklist() {
  const current = KycChecklist_useSelectedClient();
  const [done, setDone] = useState<readonly string[]>(
    CHECKS.filter((check) => check.done).map((check) => check.id),
  );

  return (
    <Panel data-demo-anchor="kyc-panel">
      <StackLayout gap={2}>
        <H2 styleAs="h3">{`KYC · ${current.name}`}</H2>
        <StackLayout as="ul" gap={0} role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {CHECKS.map((check, index) => (
            <li key={check.id} data-demo-anchor={`check-${check.id}`}>
              {index > 0 && <Divider variant="tertiary" />}
              <FlexLayout
                justify="space-between"
                align="center"
                gap={1}
                style={{ paddingBlock: "var(--salt-spacing-100)" }}
              >
                <Text>{check.label}</Text>
                {done.includes(check.id) ? (
                  <FlexLayout gap={0.5} align="center" style={{ flexShrink: 0 }}>
                    <StatusIndicator status="success" />
                    <Text>Done</Text>
                  </FlexLayout>
                ) : (
                  <Button
                    sentiment="neutral"
                    appearance="transparent"
                    onClick={() => setDone((ids) => [...ids, check.id])}
                    data-demo-anchor={`complete-${check.id}`}
                    aria-label={`Complete: ${check.label}`}
                    style={{ flexShrink: 0 }}
                  >
                    <CheckmarkIcon aria-hidden />
                    Complete
                  </Button>
                )}
              </FlexLayout>
            </li>
          ))}
        </StackLayout>
        <FormField>
          <FormFieldLabel>Reviewer note</FormFieldLabel>
          <MultilineInput
            rows={2}
            textAreaProps={{ id: "kyc-note", "data-demo-anchor": "kyc-note" }}
          />
        </FormField>
      </StackLayout>
    </Panel>
  );
}

type DocumentReview_DocStatus = "Received" | "Awaiting review" | "Missing" | "Approved";

const DocumentReview_DOC_TONES: Record<DocumentReview_DocStatus, "success" | "info" | "error"> = {
  Received: "success",
  "Awaiting review": "info",
  Missing: "error",
  Approved: "success",
};

function DocumentReview() {
  const approver = useProfile().persona === "Approver";
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [verified, setVerified] = useState(false);

  return (
    <Card data-demo-anchor="documents-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={2} wrap>
          <H2>Document review</H2>
          <Button
            sentiment="accented"
            appearance="solid"
            onClick={() => {
              planted.blockMainThread(650);
              setVerified(true);
            }}
            data-demo-anchor="verify-documents"
          >
            <CheckmarkIcon aria-hidden />
            Verify all documents
          </Button>
        </FlexLayout>
        {verified && <Text color="secondary">Every received document matched its checksum.</Text>}
        <TableContainer>
          <Table aria-label="Onboarding documents">
            <THead>
              <TR>
                <TH>Document</TH>
                <TH>Client</TH>
                <TH>Due</TH>
                <TH>Status</TH>
                {approver && <TH>Approval</TH>}
              </TR>
            </THead>
            <TBody>
              {DOCUMENTS.map((document) => {
                const status: DocumentReview_DocStatus = approved.includes(document.id) ? "Approved" : document.status;
                return (
                  <TR key={document.id} data-demo-anchor={`document-${document.id}`}>
                    <TD>{document.name}</TD>
                    <TD>{document.client}</TD>
                    <TD>{document.due}</TD>
                    <TD>
                      <FlexLayout gap={1} align="center">
                        <StatusIndicator status={DocumentReview_DOC_TONES[status]} />
                        <Text>{status}</Text>
                      </FlexLayout>
                    </TD>
                    {approver && (
                      <TD>
                        {status === "Awaiting review" ? (
                          <Button
                            sentiment="accented"
                            appearance="solid"
                            onClick={() => setApproved((ids) => [...ids, document.id])}
                            data-demo-anchor={`approve-${document.id}`}
                          >
                            {`Approve ${document.id}`}
                          </Button>
                        ) : (
                          <Text color="secondary">None needed</Text>
                        )}
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>
        {!approver && <Text color="secondary">Document approvals are available to the Approver role.</Text>}
      </StackLayout>
    </Card>
  );
}

export default function ClientOnboarding() {
  return (
    <GridLayout columns={3} gap={3}>
      <GridItem colSpan={2}>
        <ClientSearch />
      </GridItem>
      <GridItem colSpan={1}>
        <KycChecklist />
      </GridItem>
      <GridItem colSpan={3}>
        <DocumentReview />
      </GridItem>
    </GridLayout>
  );
}
