// Bulk payments upload: the Uploads route as one page, composed from its microfrontends at their conformant versions:
// payment-file-upload 1.1.0 (main)
// batch-release 1.0.0 (side)
import { useBus, usePublish } from "@deweb/portal";
import { Button, Checkbox, CheckboxGroup, Display4, FileDropZone, FileDropZoneIcon, FileDropZoneTrigger, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridItem, GridLayout, H2, H3, Input, Panel, StackLayout, StatusIndicator, Table, TableContainer, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { type Batch, BATCHES, DEBIT_ACCOUNT, FILES, ISSUES, type PaymentFile, type Validation } from "./data";
import styles from "./page.module.css";

const PaymentFileUpload_money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PaymentFileUpload_TONE: Record<Validation | "Validating", "success" | "warning" | "error" | "info"> = { Passed: "success", "Passed with warnings": "warning", Failed: "error", Validating: "info" };

const PaymentFileUpload_SEVERITY = { Error: "error", Warning: "warning" } as const;

const PaymentFileUpload_ACCEPTED = /\.(csv|xml)$/i;

function PaymentFileUpload() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(FILES[0]!.id);
  const [received, setReceived] = useState<string[]>([]);
  const [upload, setUpload] = useState<{ status: "success" | "error"; message: string } | null>(null);
  const publish = usePublish("payment-file-upload");
  const search = query.trim().toLowerCase();
  const rows = FILES.filter((file) => file.name.toLowerCase().includes(search) || file.uploadedBy.toLowerCase().includes(search));
  const chosen = FILES.find((file) => file.id === selected)!;
  const issues = ISSUES[chosen.id] ?? [];
  const errors = issues.filter((issue) => issue.severity === "Error").length;
  const queued = received.filter((name) => name.toLowerCase().includes(search));

  const choose = (file: PaymentFile) => {
    setSelected(file.id);
    publish("file:selected", { id: file.id, name: file.name });
  };

  const accept = (files: File[]) => {
    const rejected = files.filter((file) => !PaymentFileUpload_ACCEPTED.test(file.name));
    const valid = files.filter((file) => PaymentFileUpload_ACCEPTED.test(file.name)).map((file) => file.name);
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
                        <StatusIndicator status={PaymentFileUpload_TONE.Validating} />
                        <Text>Validating</Text>
                      </FlexLayout>
                    </TD>
                  </TR>
                ))}
                {rows.map((file) => {
                  const current = file.id === selected;
                  return (
                    <TR key={file.id} aria-current={current ? "true" : undefined} className={current ? styles["PaymentFileUpload_selected"] : undefined} data-demo-anchor={`file-${file.id}`}>
                      <TD>
                        <StackLayout gap={1} align="start">
                          <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(file)}>
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
                      <TD textAlign="right" className={styles["PaymentFileUpload_figure"]}>
                        {file.lines.toLocaleString("en-US")}
                      </TD>
                      <TD textAlign="right" className={styles["PaymentFileUpload_figure"]}>
                        {PaymentFileUpload_money(file.currency, file.total)}
                      </TD>
                      <TD>
                        <FlexLayout gap={1} align="center" wrap={false}>
                          <StatusIndicator status={PaymentFileUpload_TONE[file.validation]} />
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
        <StackLayout gap={2} as="section" aria-labelledby="payment-file-upload-lines">
          <StackLayout gap={1}>
            <H3 id="payment-file-upload-lines">{`Line results for ${chosen.name}`}</H3>
            <Text color="secondary">
              {issues.length === 0
                ? `All ${chosen.lines.toLocaleString("en-US")} lines passed validation.`
                : `${errors} ${errors === 1 ? "error" : "errors"} and ${issues.length - errors} ${issues.length - errors === 1 ? "warning" : "warnings"} across ${chosen.lines.toLocaleString("en-US")} lines. Fix errors in the source file and upload it again; warnings don't block release.`}
            </Text>
          </StackLayout>
          {issues.length > 0 && (
            <TableContainer>
              <Table aria-labelledby="payment-file-upload-lines" variant="secondary">
                <THead>
                  <TR>
                    <TH textAlign="right">Line</TH>
                    <TH>Beneficiary</TH>
                    <TH>Problem</TH>
                    <TH>Severity</TH>
                  </TR>
                </THead>
                <TBody>
                  {issues.map((issue) => (
                    <TR key={issue.line}>
                      <TD textAlign="right" className={styles["PaymentFileUpload_figure"]}>
                        {issue.line}
                      </TD>
                      <TD>{issue.beneficiary}</TD>
                      <TD>{issue.problem}</TD>
                      <TD>
                        <FlexLayout gap={1} align="center" wrap={false}>
                          <StatusIndicator status={PaymentFileUpload_SEVERITY[issue.severity]} />
                          <Text>{issue.severity}</Text>
                        </FlexLayout>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </StackLayout>
      </StackLayout>
    </Panel>
  );
}

const BatchRelease_money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const BatchRelease_sum = (batches: readonly Batch[]) => batches.reduce((total, batch) => total + batch.total, 0);

const BatchRelease_plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "es"}`;

function BatchRelease_Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text className={styles["BatchRelease_figure"]}>{value}</Text>
    </StackLayout>
  );
}

function BatchRelease_ReleaseForm({ file, batches, released, onRelease }: { file: PaymentFile; batches: readonly Batch[]; released: readonly string[]; onRelease: (ids: string[]) => void }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState("");
  const ready = batches.filter((batch) => !batch.held && !released.includes(batch.id));

  const toggle = (event: ChangeEvent<HTMLInputElement>) => {
    const { value, checked } = event.target;
    setChosen((current) => (checked ? [...current, value] : current.filter((id) => id !== value)));
    setInvalid(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const releasing = ready.filter((batch) => chosen.includes(batch.id));
    if (releasing.length === 0) {
      setInvalid(true);
      setMessage("");
      return;
    }
    onRelease(releasing.map((batch) => batch.id));
    setChosen([]);
    setMessage(`Released ${BatchRelease_plural(releasing.length, "batch")}, ${BatchRelease_money(file.currency, BatchRelease_sum(releasing))}, at 14:32 ET.`);
  };

  return (
    <form onSubmit={submit} aria-labelledby="batch-release-form">
      <StackLayout gap={2}>
        <H3 id="batch-release-form">Batches</H3>
        <FormField validationStatus={invalid ? "error" : undefined}>
          <FormFieldLabel>Batches to release</FormFieldLabel>
          <CheckboxGroup checkedValues={chosen} onChange={toggle}>
            {batches.map((batch) => {
              const done = released.includes(batch.id);
              return (
                <Checkbox
                  key={batch.id}
                  value={batch.id}
                  disabled={done || batch.held !== undefined}
                  label={
                    <StackLayout gap={1}>
                      <Text>{`${batch.name}, ${BatchRelease_money(file.currency, batch.total)}`}</Text>
                      <Text styleAs="label" color="secondary">
                        {done ? `Released · value date ${batch.valueDate}` : batch.held ? `Held: ${batch.held}` : `${batch.lines} lines · value date ${batch.valueDate}`}
                      </Text>
                    </StackLayout>
                  }
                />
              );
            })}
          </CheckboxGroup>
          <FormFieldHelperText>{invalid ? "Choose at least one batch to release." : ready.length === 0 ? "Nothing here is ready to release." : `Released batches debit ${DEBIT_ACCOUNT} on their value date.`}</FormFieldHelperText>
        </FormField>
        <FlexLayout gap={2} align="center" wrap>
          {ready.length > 0 && (
            <Button type="submit" sentiment="accented">
              Release batches
            </Button>
          )}
          <Text role="status" color="secondary">
            {message}
          </Text>
        </FlexLayout>
      </StackLayout>
    </form>
  );
}

function BatchRelease() {
  const [id, setId] = useState(FILES[0]!.id);
  const [released, setReleased] = useState<Record<string, string[]>>({});
  useBus("file:selected", "batch-release", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && FILES.some((file) => file.id === next)) setId(next);
  });
  const file = FILES.find((entry) => entry.id === id)!;
  const batches = BATCHES[file.id] ?? [];
  const done = released[file.id] ?? [];
  const ready = batches.filter((batch) => !batch.held && !done.includes(batch.id));
  const held = batches.filter((batch) => batch.held);

  const release = (ids: string[]) => setReleased((current) => ({ ...current, [file.id]: [...(current[file.id] ?? []), ...ids] }));

  return (
    <Panel data-demo-anchor="batch-release-panel">
      <StackLayout gap={3}>
        <StackLayout gap={1}>
          <H2>{file.name}</H2>
          <Text color="secondary">{`${file.lines.toLocaleString("en-US")} lines · uploaded by ${file.uploadedBy}`}</Text>
        </StackLayout>
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary">
            Ready to release
          </Text>
          <Display4 className={styles["BatchRelease_figure"]}>{BatchRelease_money(file.currency, BatchRelease_sum(ready))}</Display4>
          <Text color="secondary">{`${BatchRelease_plural(ready.length, "batch")} of ${batches.length}`}</Text>
        </StackLayout>
        <GridLayout columns={2} gap={2}>
          <BatchRelease_Figure label="File total" value={BatchRelease_money(file.currency, file.total)} />
          <BatchRelease_Figure label="Held" value={BatchRelease_money(file.currency, BatchRelease_sum(held))} />
        </GridLayout>
        {held.length > 0 && (
          <FlexLayout gap={1} align="center">
            <StatusIndicator status="error" />
            <Text>{`${BatchRelease_plural(held.length, "batch")} held until the failed lines are fixed and the file is uploaded again.`}</Text>
          </FlexLayout>
        )}
        <BatchRelease_ReleaseForm key={file.id} file={file} batches={batches} released={done} onRelease={release} />
      </StackLayout>
    </Panel>
  );
}

export default function BulkPaymentsUpload() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <PaymentFileUpload />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <BatchRelease />
      </GridItem>
    </GridLayout>
  );
}
