import { useProfile } from "@deweb/portal";
import { Button, Display3, FlexLayout, GridLayout, H2, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { CheckmarkIcon } from "@salt-ds/icons";
import { useState } from "react";
import { DOCUMENTS } from "../data";
import styles from "./1.6.0.module.css";

type Status = (typeof DOCUMENTS)[number]["status"] | "Approved";

const TONE = {
  Received: "success",
  Approved: "success",
  "Awaiting review": "info",
  Missing: "error",
} as const;

function Figure({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Display3 className={styles.figure}>{`${value}`}</Display3>
      <Text color="secondary">{detail}</Text>
    </StackLayout>
  );
}

export default function DocumentReview() {
  const approver = useProfile().persona === "Approver";
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [verified, setVerified] = useState(false);
  const status = (entry: (typeof DOCUMENTS)[number]): Status => (approved.includes(entry.id) ? "Approved" : entry.status);
  const count = (wanted: Status) => DOCUMENTS.filter((entry) => status(entry) === wanted).length;

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
          <Figure label="Awaiting review" value={count("Awaiting review")} detail="Needs an Approver" />
          <Figure label="Missing" value={count("Missing")} detail="Request from the client" />
          <Figure label="Received" value={count("Received") + count("Approved")} detail={`Of ${DOCUMENTS.length} requested`} />
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
                        <StatusIndicator status={TONE[current]} aria-hidden />
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
