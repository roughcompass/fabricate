// Client onboarding: the Clients route as one page, composed from its microfrontends at their conformant versions:
// client-search 4.2.0 (main)
// kyc-checklist 3.3.0 (side)
// document-review 1.6.0 (wide)
import { useBus, useProfile, usePublish } from "@deweb/portal";
import { Button, Display3, FlexItem, FlexLayout, FlowLayout, FormField, FormFieldHelperText, FormFieldLabel, GridItem, GridLayout, H2, H3, Input, MultilineInput, Panel, StackLayout, StatusIndicator, Table, TableContainer, TBody, TD, Text, TH, THead, ToggleButton, TR } from "@salt-ds/core";
import { CheckmarkIcon, SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { CHECKS, type Client, CLIENTS, DOCUMENTS } from "./data";
import styles from "./page.module.css";

const ClientSearch_SEGMENTS = ["All", "Corporate", "Commercial", "Financial institution"];

const ClientSearch_tone = (stage: string) => (stage === "Approved" ? "success" : "info");

function ClientSearch() {
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState("All");
  const [selected, setSelected] = useState(CLIENTS[0]!.id);
  const publish = usePublish("client-search");
  const search = query.trim().toLowerCase();
  const rows = CLIENTS.filter((client) => client.name.toLowerCase().includes(search) && (segment === "All" || client.segment === segment));

  const choose = (client: Client) => {
    setSelected(client.id);
    publish("client:selected", { id: client.id, name: client.name });
  };

  const empty = search
    ? `No ${segment === "All" ? "" : `${segment} `}clients match "${query.trim()}". Clear the search${segment === "All" ? "" : " or choose All"} to see more clients.`
    : `No clients are in the ${segment} segment. Choose All to see every client.`;

  return (
    <Panel data-demo-anchor="client-panel">
      <StackLayout gap={2}>
        <H2>Clients</H2>
        <FormField>
          <FormFieldLabel>Search clients</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="Client name"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "client-search" }}
          />
        </FormField>
        <StackLayout gap={1}>
          <Text id="client-segment" styleAs="label" color="secondary">
            Segment
          </Text>
          <FlowLayout gap={1} role="group" aria-labelledby="client-segment">
            {ClientSearch_SEGMENTS.map((option) => (
              <ToggleButton key={option} value={option} selected={segment === option} onChange={() => setSegment(option)} data-demo-anchor={`segment-${option}`}>
                {option}
              </ToggleButton>
            ))}
          </FlowLayout>
        </StackLayout>
        <StackLayout gap={1}>
          <H3 id="recent-clients">Recently viewed clients</H3>
          {rows.length === 0 ? (
            <Text color="secondary">{empty}</Text>
          ) : (
            <TableContainer>
              <Table aria-labelledby="recent-clients">
                <THead sticky>
                  <TR>
                    <TH>Client</TH>
                    <TH>Segment</TH>
                    <TH>Country</TH>
                    <TH>Stage</TH>
                    <TH>Last viewed</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((client) => {
                    const current = client.id === selected;
                    return (
                      <TR key={client.id} aria-current={current ? "true" : undefined} className={current ? styles["ClientSearch_selected"] : undefined}>
                        <TD>
                          <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(client)} data-demo-anchor={`client-${client.id}`}>
                            {client.name}
                          </Button>
                        </TD>
                        <TD>{client.segment}</TD>
                        <TD>{client.country}</TD>
                        <TD>
                          <FlexLayout gap={1} align="center">
                            <StatusIndicator status={ClientSearch_tone(client.stage)} aria-hidden />
                            <Text>{client.stage}</Text>
                          </FlexLayout>
                        </TD>
                        <TD>
                          <Text styleAs="label" color="secondary">
                            {client.viewed}
                          </Text>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </StackLayout>
      </StackLayout>
    </Panel>
  );
}

const KycChecklist_findClient = (id: string) => CLIENTS.find((client) => client.id === id);

function KycChecklist_useSelectedClient(): Client {
  const [id, setId] = useState(CLIENTS[0]!.id);
  useBus("client:selected", "kyc-checklist", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && KycChecklist_findClient(next)) setId(next);
  });
  return KycChecklist_findClient(id)!;
}

function KycChecklist() {
  const client = KycChecklist_useSelectedClient();
  const [done, setDone] = useState<readonly string[]>(CHECKS.filter((check) => check.done).map((check) => check.id));

  return (
    <Panel data-demo-anchor="kyc-panel">
      <StackLayout gap={2}>
        <StackLayout gap={1}>
          <H2>{`KYC · ${client.name}`}</H2>
          <Text color="secondary">{`${client.segment} · ${client.country}`}</Text>
        </StackLayout>
        <StackLayout as="ul" gap={2} separators className={styles["KycChecklist_list"]}>
          {CHECKS.map((check) => (
            <FlexLayout as="li" key={check.id} justify="space-between" align="center" gap={1} data-demo-anchor={`check-${check.id}`}>
              <Text>{check.label}</Text>
              <FlexItem shrink={0}>
                {done.includes(check.id) ? (
                  <FlexLayout gap={1} align="center">
                    <StatusIndicator status="success" aria-hidden />
                    <Text>Done</Text>
                  </FlexLayout>
                ) : (
                  <Button sentiment="neutral" appearance="transparent" aria-label={`Complete: ${check.label}`} onClick={() => setDone((ids) => [...ids, check.id])} data-demo-anchor={`complete-${check.id}`}>
                    <CheckmarkIcon aria-hidden />
                    Complete
                  </Button>
                )}
              </FlexItem>
            </FlexLayout>
          ))}
        </StackLayout>
        <FormField>
          <FormFieldLabel>Reviewer note</FormFieldLabel>
          <MultilineInput rows={2} textAreaProps={{ "data-demo-anchor": "kyc-note" }} />
          <FormFieldHelperText>Everyone reviewing this client can read the note.</FormFieldHelperText>
        </FormField>
      </StackLayout>
    </Panel>
  );
}

type DocumentReview_Status = (typeof DOCUMENTS)[number]["status"] | "Approved";

const DocumentReview_TONE = {
  Received: "success",
  Approved: "success",
  "Awaiting review": "info",
  Missing: "error",
} as const;

function DocumentReview_Figure({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Display3 className={styles["DocumentReview_figure"]}>{`${value}`}</Display3>
      <Text color="secondary">{detail}</Text>
    </StackLayout>
  );
}

function DocumentReview() {
  const approver = useProfile().persona === "Approver";
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [verified, setVerified] = useState(false);
  const status = (entry: (typeof DOCUMENTS)[number]): DocumentReview_Status => (approved.includes(entry.id) ? "Approved" : entry.status);
  const count = (wanted: DocumentReview_Status) => DOCUMENTS.filter((entry) => status(entry) === wanted).length;

  return (
    <Panel data-demo-anchor="documents-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={1} wrap>
          <H2>Document review</H2>
          <Button sentiment="accented" appearance="solid" onClick={() => setVerified(true)} data-demo-anchor="verify-documents">
            <CheckmarkIcon aria-hidden />
            Verify all documents
          </Button>
        </FlexLayout>
        <GridLayout columns={{ xs: 1, sm: 3 }} gap={2}>
          <DocumentReview_Figure label="Awaiting review" value={count("Awaiting review")} detail="Needs an Approver" />
          <DocumentReview_Figure label="Missing" value={count("Missing")} detail="Request from the client" />
          <DocumentReview_Figure label="Received" value={count("Received") + count("Approved")} detail={`Of ${DOCUMENTS.length} requested`} />
        </GridLayout>
        <Text role="status" color="secondary">
          {verified ? "Every received document matched its checksum." : ""}
        </Text>
        <TableContainer>
          <Table aria-label="Onboarding documents">
            <THead sticky>
              <TR>
                <TH>Document</TH>
                <TH>Client</TH>
                <TH>Due</TH>
                <TH>Status</TH>
                {approver && <TH>Approval</TH>}
              </TR>
            </THead>
            <TBody>
              {DOCUMENTS.map((entry) => {
                const current = status(entry);
                return (
                  <TR key={entry.id} data-demo-anchor={`document-${entry.id}`}>
                    <TD>
                      <StackLayout gap={0}>
                        <Text>{entry.name}</Text>
                        <Text styleAs="label" color="secondary">
                          {entry.id}
                        </Text>
                      </StackLayout>
                    </TD>
                    <TD>{entry.client}</TD>
                    <TD>{entry.due}</TD>
                    <TD>
                      <FlexLayout gap={1} align="center">
                        <StatusIndicator status={DocumentReview_TONE[current]} aria-hidden />
                        <Text>{current}</Text>
                      </FlexLayout>
                    </TD>
                    {approver && (
                      <TD>
                        {current === "Awaiting review" ? (
                          <Button sentiment="accented" appearance="transparent" onClick={() => setApproved((ids) => [...ids, entry.id])} data-demo-anchor={`approve-${entry.id}`}>
                            {`Approve ${entry.id}`}
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
    </Panel>
  );
}

export default function ClientOnboarding() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <ClientSearch />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <KycChecklist />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 3 }}>
        <DocumentReview />
      </GridItem>
    </GridLayout>
  );
}
