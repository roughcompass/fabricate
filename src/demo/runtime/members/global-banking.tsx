"use client";

import { useState } from "react";
import { useBusSubscription, usePersona, usePublish } from "../runtime-context";
import { Icon } from "./icons";
import { blockMainThread } from "./planted";
import { Badge, Button, Field, Muted, Panel, Stat, Table, Td, TextInput, Th, Tr, uiStyles } from "./ui";

/** The Client onboarding hero: client search, KYC checklist, and document review. */

interface Client {
  id: string;
  name: string;
  segment: string;
  country: string;
  stage: string;
}

const CLIENTS: readonly Client[] = [
  { id: "halcyon", name: "Halcyon Maritime Ltd", segment: "Corporate", country: "Singapore", stage: "KYC review" },
  { id: "orchard", name: "Orchard Lane Partners", segment: "Financial institution", country: "United Kingdom", stage: "Documents" },
  { id: "tessera", name: "Tessera Robotics", segment: "Corporate", country: "Germany", stage: "KYC review" },
  { id: "meridian", name: "Meridian Agri Holdings", segment: "Commercial", country: "Brazil", stage: "Screening" },
  { id: "polaris", name: "Polaris Health Group", segment: "Corporate", country: "Canada", stage: "Approved" },
];

const client = (id: string) => CLIENTS.find((entry) => entry.id === id);

function ClientSearch({ segments }: { segments: boolean }) {
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState("All");
  const [selected, setSelected] = useState(CLIENTS[0]!.id);
  const publish = usePublish("client-search");
  const rows = CLIENTS.filter((entry) => entry.name.toLowerCase().includes(query.trim().toLowerCase()) && (segment === "All" || entry.segment === segment));
  return (
    <Panel title="Clients" anchor="client-panel">
      <Field id="client-query" label="Search clients">
        <TextInput id="client-query" type="search" placeholder="Client name" value={query} onChange={(event) => setQuery(event.currentTarget.value)} anchor="client-search" />
      </Field>
      {segments && (
        <div className={uiStyles.row} role="group" aria-label="Segment">
          {["All", "Corporate", "Commercial", "Financial institution"].map((option) => (
            <Button key={option} variant={segment === option ? "primary" : "secondary"} aria-pressed={segment === option} onClick={() => setSegment(option)} anchor={`segment-${option}`}>
              {option}
            </Button>
          ))}
        </div>
      )}
      <ul className={uiStyles.list} aria-label="Recently viewed clients">
        {rows.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className={[uiStyles.rowButton, selected === entry.id && uiStyles.selected].filter(Boolean).join(" ")}
              aria-pressed={selected === entry.id}
              onClick={() => {
                setSelected(entry.id);
                publish("client:selected", { id: entry.id, name: entry.name });
              }}
              data-demo-anchor={`client-${entry.id}`}
            >
              <span>
                <strong>{entry.name}</strong>
                <br />
                <span className={uiStyles.muted}>{`${entry.segment} · ${entry.country}`}</span>
              </span>
              <Badge tone={entry.stage === "Approved" ? "positive" : "accent"}>{entry.stage}</Badge>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const CHECKS = [
  { id: "identity", label: "Verify legal entity identity", done: true },
  { id: "ownership", label: "Confirm beneficial ownership", done: true },
  { id: "sanctions", label: "Screen against sanctions lists", done: false },
  { id: "source", label: "Document source of funds", done: false },
  { id: "risk", label: "Assign a risk rating", done: false },
];

function useSelectedClient(): Client {
  const [id, setId] = useState(CLIENTS[0]!.id);
  useBusSubscription("client:selected", "kyc-checklist", (payload) => {
    const next = (payload as { id?: unknown })?.id;
    if (typeof next === "string" && client(next)) setId(next);
  });
  return client(id)!;
}

/**
 * PLANTED DEFECTS (KYC checklist 3.2.0): the note field has no label, the
 * check descriptions use the deliberately faint token, and the complete
 * buttons are icons with no accessible name. Version 3.3.0 fixes all three.
 */
export function KycChecklist320() {
  const current = useSelectedClient();
  const [done, setDone] = useState<readonly string[]>(CHECKS.filter((check) => check.done).map((check) => check.id));
  return (
    <Panel title={`KYC · ${current.name}`} anchor="kyc-panel">
      <ul className={uiStyles.list}>
        {CHECKS.map((check) => (
          <li key={check.id} className={uiStyles.listItem} data-demo-anchor={`check-${check.id}`}>
            <span className={uiStyles.defectFaint}>{check.label}</span>
            {done.includes(check.id) ? (
              <Badge tone="positive">Done</Badge>
            ) : (
              <button type="button" className={[uiStyles.button, uiStyles.ghost].join(" ")} onClick={() => setDone((ids) => [...ids, check.id])} data-demo-anchor={`complete-${check.id}`}>
                <Icon name="check" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className={uiStyles.muted}>Reviewer note</p>
      <textarea className={uiStyles.input} rows={2} data-demo-anchor="kyc-note" />
    </Panel>
  );
}

function KycChecklist({ grouped }: { grouped: boolean }) {
  const current = useSelectedClient();
  const [done, setDone] = useState<readonly string[]>(CHECKS.filter((check) => check.done).map((check) => check.id));
  const remaining = CHECKS.length - done.length;
  return (
    <Panel title={`KYC · ${current.name}`} anchor="kyc-panel" actions={grouped ? <Badge tone="accent">{`Preview: ${done.length} of ${CHECKS.length} complete`}</Badge> : undefined}>
      {grouped && <Stat label="Steps remaining" value={`${remaining}`} detail={remaining ? "Complete every step before approval" : "Ready for approval"} />}
      <ul className={uiStyles.list}>
        {CHECKS.map((check) => (
          <li key={check.id} className={uiStyles.listItem} data-demo-anchor={`check-${check.id}`}>
            <span>{check.label}</span>
            {done.includes(check.id) ? (
              <Badge tone="positive">Done</Badge>
            ) : (
              <Button variant="ghost" onClick={() => setDone((ids) => [...ids, check.id])} anchor={`complete-${check.id}`} aria-label={`Complete: ${check.label}`}>
                <Icon name="check" />
                Complete
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Field id={grouped ? "kyc-note-grouped" : "kyc-note"} label="Reviewer note">
        <textarea id={grouped ? "kyc-note-grouped" : "kyc-note"} className={uiStyles.input} rows={2} data-demo-anchor="kyc-note" />
      </Field>
    </Panel>
  );
}

const DOCUMENTS = [
  { id: "DOC-1042", name: "Certificate of incorporation", client: "Halcyon Maritime Ltd", due: "Oct 2", status: "Received" },
  { id: "DOC-1043", name: "Register of directors", client: "Halcyon Maritime Ltd", due: "Oct 2", status: "Awaiting review" },
  { id: "DOC-1051", name: "Proof of address", client: "Tessera Robotics", due: "Oct 4", status: "Awaiting review" },
  { id: "DOC-1060", name: "Audited financials 2025", client: "Orchard Lane Partners", due: "Oct 9", status: "Missing" },
] as const;

const DOC_TONES = { Received: "positive", "Awaiting review": "accent", Missing: "negative", Approved: "positive" } as const;

export function DocumentReview() {
  const persona = usePersona();
  const approver = persona.role === "Approver";
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [verified, setVerified] = useState(false);
  return (
    <Panel
      title="Document review"
      anchor="documents-panel"
      actions={
        <Button
          onClick={() => {
            blockMainThread(650);
            setVerified(true);
          }}
          anchor="verify-documents"
        >
          <Icon name="file" />
          Verify all documents
        </Button>
      }
    >
      {verified && <Muted>Every received document matched its checksum.</Muted>}
      <Table label="Onboarding documents" head={<><Th>Document</Th><Th>Client</Th><Th>Due</Th><Th>Status</Th>{approver && <Th>Approval</Th>}</>}>
        {DOCUMENTS.map((document) => {
          const status = approved.includes(document.id) ? "Approved" : document.status;
          return (
            <Tr key={document.id} anchor={`document-${document.id}`}>
              <Td>{document.name}</Td>
              <Td>{document.client}</Td>
              <Td>{document.due}</Td>
              <Td>
                <Badge tone={DOC_TONES[status]}>{status}</Badge>
              </Td>
              {approver && (
                <Td>
                  {status === "Awaiting review" ? (
                    <Button variant="primary" onClick={() => setApproved((ids) => [...ids, document.id])} anchor={`approve-${document.id}`}>
                      {`Approve ${document.id}`}
                    </Button>
                  ) : (
                    <span className={uiStyles.muted}>None needed</span>
                  )}
                </Td>
              )}
            </Tr>
          );
        })}
      </Table>
      {!approver && <Muted>Document approvals are available to the Approver role.</Muted>}
    </Panel>
  );
}

export const GLOBAL_BANKING_MEMBERS = {
  "client-search": { "4.1.0": () => <ClientSearch segments={false} />, "4.2.0": () => <ClientSearch segments /> },
  "kyc-checklist": { "3.2.0": KycChecklist320, "3.3.0": () => <KycChecklist grouped={false} />, "4.0.0-rc.1": () => <KycChecklist grouped /> },
  "document-review": { "1.6.0": DocumentReview },
} as const;
