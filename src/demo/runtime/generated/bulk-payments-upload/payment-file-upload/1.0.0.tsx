import { usePublish } from "@deweb/portal";
import { Button, FileDropZone, FileDropZoneIcon, FileDropZoneTrigger, FlexLayout, FormField, FormFieldLabel, H2, Input, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { DEBIT_ACCOUNT, FILES, type PaymentFile, type Validation } from "../data";
import styles from "./1.0.0.module.css";

const money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE: Record<Validation | "Validating", "success" | "warning" | "error" | "info"> = { Passed: "success", "Passed with warnings": "warning", Failed: "error", Validating: "info" };
const ACCEPTED = /\.(csv|xml)$/i;

export default function PaymentFileUpload() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(FILES[0]!.id);
  const [received, setReceived] = useState<string[]>([]);
  const [upload, setUpload] = useState<{ status: "success" | "error"; message: string } | null>(null);
  const publish = usePublish("payment-file-upload");
  const search = query.trim().toLowerCase();
  const rows = FILES.filter((file) => file.name.toLowerCase().includes(search) || file.uploadedBy.toLowerCase().includes(search));
  const queued = received.filter((name) => name.toLowerCase().includes(search));

  const choose = (file: PaymentFile) => {
    setSelected(file.id);
    publish("file:selected", { id: file.id, name: file.name });
  };

  const accept = (files: File[]) => {
    const rejected = files.filter((file) => !ACCEPTED.test(file.name));
    const valid = files.filter((file) => ACCEPTED.test(file.name)).map((file) => file.name);
    if (rejected.length > 0) {
      setUpload({ status: "error", message: `${rejected.map((file) => file.name).join(", ")} isn't a payment file. Upload a CSV or ISO 20022 XML file.` });
    } else if (valid.length > 0) {
      setUpload({ status: "success", message: `${valid.join(", ")} received. Validation takes about two minutes.` });
    }
    if (valid.length > 0) setReceived((current) => [...valid.filter((name) => !current.includes(name)), ...current]);
  };

  return (
    <Panel data-demo-anchor="payment-file-upload-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Payment files</H2>
          <Text styleAs="label" color="secondary">{`Debits ${DEBIT_ACCOUNT}`}</Text>
        </FlexLayout>
        <FileDropZone status={upload?.status} onDrop={(_event, files) => accept(files)}>
          <FileDropZoneIcon status={upload?.status} />
          <Text fontWeight="bolder">Drop a payment file here</Text>
          <Text color="secondary">CSV or ISO 20022 XML, up to 5,000 lines</Text>
          <FileDropZoneTrigger accept=".csv,.xml" multiple onChange={(_event, files) => accept(files)} />
          <Text role="status" color="secondary">
            {upload?.message ?? ""}
          </Text>
        </FileDropZone>
        <FormField>
          <FormFieldLabel>Find a file</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="File name or uploader"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "file-search" }}
          />
        </FormField>
        {rows.length + queued.length === 0 ? (
          <Text color="secondary">{`No files match "${query.trim()}". Clear the search to see every file.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Payment files">
              <THead sticky>
                <TR>
                  <TH>File</TH>
                  <TH>Uploaded</TH>
                  <TH textAlign="right">Lines</TH>
                  <TH textAlign="right">Total</TH>
                  <TH>Validation</TH>
                </TR>
              </THead>
              <TBody>
                {queued.map((name) => (
                  <TR key={`queued-${name}`}>
                    <TD>
                      <Text>{name}</Text>
                    </TD>
                    <TD>
                      <Text styleAs="label" color="secondary">
                        Just now, by you
                      </Text>
                    </TD>
                    <TD textAlign="right">
                      <Text color="secondary">Counting</Text>
                    </TD>
                    <TD textAlign="right">
                      <Text color="secondary">Counting</Text>
                    </TD>
                    <TD>
                      <FlexLayout gap={1} align="center" wrap={false}>
                        <StatusIndicator status={TONE.Validating} />
                        <Text>Validating</Text>
                      </FlexLayout>
                    </TD>
                  </TR>
                ))}
                {rows.map((file) => {
                  const current = file.id === selected;
                  return (
                    <TR key={file.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`file-${file.id}`}>
                      <TD>
                        <StackLayout gap={1} align="start">
                          <Button sentiment="neutral" appearance="transparent" className={styles.recordName} aria-pressed={current} onClick={() => choose(file)}>
                            {file.name}
                          </Button>
                          <Text styleAs="label" color="secondary">
                            {file.format}
                          </Text>
                        </StackLayout>
                      </TD>
                      <TD>
                        <StackLayout gap={1}>
                          <Text>{file.uploadedBy}</Text>
                          <Text styleAs="label" color="secondary">
                            {file.uploadedAt}
                          </Text>
                        </StackLayout>
                      </TD>
                      <TD textAlign="right" className={styles.figure}>
                        {file.lines.toLocaleString("en-US")}
                      </TD>
                      <TD textAlign="right" className={styles.figure}>
                        {money(file.currency, file.total)}
                      </TD>
                      <TD>
                        <FlexLayout gap={1} align="center" wrap={false}>
                          <StatusIndicator status={TONE[file.validation]} />
                          <Text>{file.validation}</Text>
                        </FlexLayout>
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
