import { useBus } from "@deweb/portal";
import { Button, Checkbox, CheckboxGroup, Display4, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridLayout, H2, H3, Panel, StackLayout, StatusIndicator, Text } from "@salt-ds/core";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { BATCHES, type Batch, DEBIT_ACCOUNT, FILES, type PaymentFile } from "../data";
import styles from "./1.0.0.module.css";

const money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sum = (batches: readonly Batch[]) => batches.reduce((total, batch) => total + batch.total, 0);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "es"}`;

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text className={styles.figure}>{value}</Text>
    </StackLayout>
  );
}

function ReleaseForm({ file, batches, released, onRelease }: { file: PaymentFile; batches: readonly Batch[]; released: readonly string[]; onRelease: (ids: string[]) => void }) {
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
    setMessage(`Released ${plural(releasing.length, "batch")}, ${money(file.currency, sum(releasing))}, at 14:32 ET.`);
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
                      <Text>{`${batch.name}, ${money(file.currency, batch.total)}`}</Text>
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

export default function BatchRelease() {
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
          <Display4 className={styles.figure}>{money(file.currency, sum(ready))}</Display4>
          <Text color="secondary">{`${plural(ready.length, "batch")} of ${batches.length}`}</Text>
        </StackLayout>
        <GridLayout columns={2} gap={2}>
          <Figure label="File total" value={money(file.currency, file.total)} />
          <Figure label="Held" value={money(file.currency, sum(held))} />
        </GridLayout>
        {held.length > 0 && (
          <FlexLayout gap={1} align="center">
            <StatusIndicator status="error" />
            <Text>{`${plural(held.length, "batch")} held until the failed lines are fixed and the file is uploaded again.`}</Text>
          </FlexLayout>
        )}
        <ReleaseForm key={file.id} file={file} batches={batches} released={done} onRelease={release} />
      </StackLayout>
    </Panel>
  );
}
