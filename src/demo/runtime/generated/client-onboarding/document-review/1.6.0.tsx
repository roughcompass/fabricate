import { useState } from "react";
import {
  Button,
  Card,
  FlexLayout,
  H2,
  StackLayout,
  StatusIndicator,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Text,
} from "@salt-ds/core";
import { CheckmarkIcon } from "@salt-ds/icons";
import { planted, useProfile } from "@deweb/portal";
import { DOCUMENTS } from "../data";

type DocStatus = "Received" | "Awaiting review" | "Missing" | "Approved";

const DOC_TONES: Record<DocStatus, "success" | "info" | "error"> = {
  Received: "success",
  "Awaiting review": "info",
  Missing: "error",
  Approved: "success",
};

export default function DocumentReview() {
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
                const status: DocStatus = approved.includes(document.id) ? "Approved" : document.status;
                return (
                  <TR key={document.id} data-demo-anchor={`document-${document.id}`}>
                    <TD>{document.name}</TD>
                    <TD>{document.client}</TD>
                    <TD>{document.due}</TD>
                    <TD>
                      <FlexLayout gap={1} align="center">
                        <StatusIndicator status={DOC_TONES[status]} />
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
