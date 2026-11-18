import { useBus } from "@deweb/portal";
import { Button, Divider, Dropdown, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, H2, H3, Input, Option, Panel, StackLayout, Text } from "@salt-ds/core";
import { SendIcon } from "@salt-ds/icons";
import { type ChangeEvent, type FormEvent, type SyntheticEvent, useState } from "react";
import { FROM_ACCOUNTS, PAYEES, usd } from "../data";

const fromLabel = (value: string) => FROM_ACCOUNTS.find((entry) => entry.value === value)?.label ?? value;
const payeeLabel = (id: string) => PAYEES.find((entry) => entry.id === id)?.name ?? id;
/** The amount as a number, or null when it isn't a positive amount. */
const parseAmount = (value: string) => {
  const amount = Number(value.replace(/,/g, "").trim());
  return value.trim() && Number.isFinite(amount) && amount > 0 ? amount : null;
};

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={0}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text>{value}</Text>
    </StackLayout>
  );
}

export default function TransferForm() {
  const [payee, setPayee] = useState<string>(PAYEES[0]!.id);
  const [from, setFrom] = useState<string>(FROM_ACCOUNTS[0].value);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  useBus("payee:selected", "transfer-form", (payload: unknown) => {
    const id = (payload as { id?: unknown } | null)?.id;
    if (typeof id === "string" && PAYEES.some((entry) => entry.id === id)) {
      setPayee(id);
      setReviewing(false);
      setConfirmation("");
    }
  });

  const record = PAYEES.find((entry) => entry.id === payee)!;
  const value = parseAmount(amount);
  /** Any edit returns the form from its review step. */
  const edit = () => {
    setReviewing(false);
    setConfirmation("");
  };

  const chooseFrom = (_event: SyntheticEvent, selected: string[]) => {
    if (selected[0]) setFrom(selected[0]);
    edit();
  };
  const choosePayee = (_event: SyntheticEvent, selected: string[]) => {
    if (selected[0]) setPayee(selected[0]);
    edit();
  };
  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value === null) {
      setInvalid(true);
      return;
    }
    if (!reviewing) {
      setReviewing(true);
      return;
    }
    setReviewing(false);
    setConfirmation(`Payment of ${usd(value)} to ${record.name} from ${fromLabel(from)} scheduled for today.`);
  };

  return (
    <Panel data-demo-anchor="transfer-panel">
      <StackLayout gap={2}>
        <H2>New transfer</H2>
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary">
            Payee
          </Text>
          <Text fontWeight="bolder">{record.name}</Text>
          <Text color="secondary">{`${record.bank} ••••${record.account} · Last paid ${record.lastPaid}`}</Text>
        </StackLayout>
        <Divider />
        <form onSubmit={send}>
          <StackLayout gap={2}>
            <FormField>
              <FormFieldLabel>From account</FormFieldLabel>
              <Dropdown data-demo-anchor="transfer-from" selected={[from]} valueToString={fromLabel} onSelectionChange={chooseFrom}>
                {FROM_ACCOUNTS.map((entry) => (
                  <Option value={entry.value} key={entry.value}>
                    {entry.label}
                  </Option>
                ))}
              </Dropdown>
            </FormField>
            <FormField>
              <FormFieldLabel>Payee</FormFieldLabel>
              <Dropdown data-demo-anchor="transfer-payee" selected={[payee]} valueToString={payeeLabel} onSelectionChange={choosePayee}>
                {PAYEES.map((entry) => (
                  <Option value={entry.id} key={entry.id}>
                    {entry.name}
                  </Option>
                ))}
              </Dropdown>
            </FormField>
            <FormField validationStatus={invalid ? "error" : undefined}>
              <FormFieldLabel>Amount (USD)</FormFieldLabel>
              <Input
                data-demo-anchor="transfer-amount"
                placeholder="0.00"
                value={amount}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setAmount(event.target.value);
                  setInvalid(false);
                  edit();
                }}
                inputProps={{ inputMode: "decimal", name: "amount" }}
              />
              {invalid && <FormFieldHelperText>Enter an amount greater than zero, such as 1,250.00.</FormFieldHelperText>}
            </FormField>
            <FormField>
              <FormFieldLabel>Payment reference</FormFieldLabel>
              <Input
                data-demo-anchor="transfer-reference"
                placeholder="INV-20431"
                value={reference}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setReference(event.target.value);
                  edit();
                }}
                inputProps={{ name: "reference" }}
              />
              <FormFieldHelperText>Shown on the payee's statement.</FormFieldHelperText>
            </FormField>
            {reviewing && value !== null && (
              <StackLayout gap={1}>
                <H3>Review payment</H3>
                <Detail label="From" value={fromLabel(from)} />
                <Detail label="To" value={`${record.name} ••••${record.account}`} />
                <Detail label="Amount" value={usd(value)} />
                <Detail label="Reference" value={reference.trim() || "None"} />
                <Text color="secondary">Select Confirm payment to send, or Edit to change the details.</Text>
              </StackLayout>
            )}
            <FlexLayout gap={1} wrap>
              {reviewing ? (
                <Button sentiment="accented" type="submit" data-demo-anchor="send-payment">
                  <SendIcon aria-hidden />
                  Confirm payment
                </Button>
              ) : (
                <Button sentiment="accented" type="submit" data-demo-anchor="send-payment">
                  <SendIcon aria-hidden />
                  Send payment
                </Button>
              )}
              {reviewing && (
                <Button appearance="bordered" sentiment="neutral" onClick={edit}>
                  Edit
                </Button>
              )}
            </FlexLayout>
            <Text role="status">{confirmation}</Text>
          </StackLayout>
        </form>
      </StackLayout>
    </Panel>
  );
}
