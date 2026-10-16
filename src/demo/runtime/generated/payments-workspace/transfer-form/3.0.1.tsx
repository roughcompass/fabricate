import { useState, type ChangeEvent } from "react";
import {
  Button,
  Divider,
  Dropdown,
  FormField,
  FormFieldLabel,
  H2,
  Input,
  Label,
  Option,
  Panel,
  StackLayout,
  Text,
} from "@salt-ds/core";
import { SendIcon } from "@salt-ds/icons";
import { useBus } from "@deweb/portal";
import { PAYEES } from "../data";

const FROM_ACCOUNTS = [
  { value: "operating", label: "Operating ···· 2290" },
  { value: "payroll", label: "Payroll ···· 7731" },
] as const;

const fromLabel = (value: string) =>
  FROM_ACCOUNTS.find((entry) => entry.value === value)?.label ?? value;

const payeeLabel = (id: string) =>
  PAYEES.find((entry) => entry.id === id)?.name ?? id;

export default function TransferForm() {
  const [payee, setPayee] = useState<string>(PAYEES[0]!.id);
  const [from, setFrom] = useState<string>("operating");
  const [amount, setAmount] = useState("");
  const [confirmation, setConfirmation] = useState<string | null>(null);

  useBus("payee:selected", "transfer-form", (payload: unknown) => {
    const id = (payload as { id?: unknown })?.id;
    if (typeof id === "string" && PAYEES.some((entry) => entry.id === id)) {
      setPayee(id);
      setConfirmation(null);
    }
  });

  const record = PAYEES.find((entry) => entry.id === payee)!;
  const payeeName = record.name;
  const submitLabel = "Send payment";

  return (
    <Panel data-demo-anchor="transfer-panel">
      <StackLayout gap={2}>
        <H2>New transfer</H2>

        <StackLayout
          gap={0.5}
          padding={1}
          style={{
            background: "var(--salt-container-secondary-background)",
            borderRadius: "var(--salt-palette-corner-weak)",
          }}
        >
          <Label color="secondary">Payee</Label>
          <Text styleAs="h3">{payeeName}</Text>
          <Text color="secondary">{`${record.bank} ••••${record.account}`}</Text>
          <Text color="secondary" styleAs="label">{`Last paid ${record.lastPaid}`}</Text>
        </StackLayout>

        <Divider />

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setConfirmation(
              `Payment of $${amount || "0.00"} to ${payeeName} scheduled for today.`,
            );
          }}
        >
          <StackLayout gap={2}>
            <FormField>
              <FormFieldLabel>From account</FormFieldLabel>
              <Dropdown
                data-demo-anchor="transfer-from"
                selected={[from]}
                valueToString={fromLabel}
                onSelectionChange={(_event, selected) => {
                  if (selected[0]) setFrom(selected[0]);
                }}
              >
                {FROM_ACCOUNTS.map((entry) => (
                  <Option value={entry.value} key={entry.value}>
                    {entry.label}
                  </Option>
                ))}
              </Dropdown>
            </FormField>

            <FormField>
              <FormFieldLabel>Payee</FormFieldLabel>
              <Dropdown
                data-demo-anchor="transfer-payee"
                selected={[payee]}
                valueToString={payeeLabel}
                onSelectionChange={(_event, selected) => {
                  if (selected[0]) setPayee(selected[0]);
                }}
              >
                {PAYEES.map((entry) => (
                  <Option value={entry.id} key={entry.id}>
                    {entry.name}
                  </Option>
                ))}
              </Dropdown>
            </FormField>

            <FormField>
              <FormFieldLabel>Amount (USD)</FormFieldLabel>
              <Input
                data-demo-anchor="transfer-amount"
                placeholder="0.00"
                value={amount}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setAmount(event.target.value)
                }
                inputProps={{ inputMode: "decimal", name: "amount" }}
              />
            </FormField>

            <Button
              sentiment="accented"
              type="submit"
              data-demo-anchor="send-payment"
              aria-label={submitLabel}
            >
              <SendIcon aria-hidden />
              {submitLabel}
            </Button>

            <Text role="status" color="secondary">
              {confirmation ?? ""}
            </Text>
          </StackLayout>
        </form>
      </StackLayout>
    </Panel>
  );
}
