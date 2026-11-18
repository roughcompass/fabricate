// Payments workspace: the Payees route as one page, composed from its microfrontends at their conformant versions:
// payee-list 2.0.0 (main)
// transfer-form 3.1.0 (side)
// payment-activity 2.3.0 (wide)
import { useBus, useProfile, usePublish } from "@deweb/portal";
import { Button, Display3, Divider, Dropdown, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridItem, GridLayout, H2, H3, Input, Option, Panel, StackLayout, StatusIndicator, Table, TableContainer, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { RefreshIcon, SearchIcon, SendIcon } from "@salt-ds/icons";
import { type ChangeEvent, type FormEvent, type SyntheticEvent, useState } from "react";
import { ACTIVITY, FROM_ACCOUNTS, money, type Payee, PAYEES, type PaymentStatus, usd } from "./data";
import styles from "./page.module.css";

function PayeeList() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const publish = usePublish("payee-list");
  const search = query.trim().toLowerCase();
  const payees = PAYEES.filter((payee) => payee.name.toLowerCase().includes(search) || payee.bank.toLowerCase().includes(search));

  const choose = (payee: Payee) => {
    setSelected(payee.id);
    publish("payee:selected", { id: payee.id, name: payee.name });
  };

  return (
    <Panel data-demo-anchor="payee-panel">
      <StackLayout gap={2}>
        <H2>Payees</H2>
        <FormField>
          <FormFieldLabel>Search payees</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="Payee or bank name"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "payee-search" }}
          />
        </FormField>
        {payees.length === 0 ? (
          <Text color="secondary">{`No payees match "${query.trim()}". Clear the search to see every payee.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Payees">
              <THead sticky>
                <TR>
                  <TH>Payee</TH>
                  <TH>Bank</TH>
                  <TH>Account</TH>
                  <TH>Last paid</TH>
                  <TH>Action</TH>
                </TR>
              </THead>
              <TBody>
                {payees.map((payee) => {
                  const current = payee.id === selected;
                  return (
                    <TR key={payee.id} aria-current={current ? "true" : undefined} className={current ? styles["PayeeList_selected"] : undefined} data-demo-anchor={`payee-${payee.id}`}>
                      <TD>
                        <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(payee)}>
                          {payee.name}
                        </Button>
                      </TD>
                      <TD>{payee.bank}</TD>
                      <TD>
                        <Text color="secondary">{`••••${payee.account}`}</Text>
                      </TD>
                      <TD>{payee.lastPaid}</TD>
                      <TD>
                        <Button sentiment="accented" appearance="transparent" aria-label={`Pay ${payee.name}`} onClick={() => choose(payee)} data-demo-anchor={`pay-${payee.id}`}>
                          <SendIcon aria-hidden />
                          Pay
                        </Button>
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

const TransferForm_fromLabel = (value: string) => FROM_ACCOUNTS.find((entry) => entry.value === value)?.label ?? value;

const TransferForm_payeeLabel = (id: string) => PAYEES.find((entry) => entry.id === id)?.name ?? id;

const TransferForm_parseAmount = (value: string) => {
  const amount = Number(value.replace(/,/g, "").trim());
  return value.trim() && Number.isFinite(amount) && amount > 0 ? amount : null;
};

function TransferForm_Detail({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={0}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text>{value}</Text>
    </StackLayout>
  );
}

function TransferForm() {
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
  const value = TransferForm_parseAmount(amount);
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
    setConfirmation(`Payment of ${usd(value)} to ${record.name} from ${TransferForm_fromLabel(from)} scheduled for today.`);
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
              <Dropdown data-demo-anchor="transfer-from" selected={[from]} valueToString={TransferForm_fromLabel} onSelectionChange={chooseFrom}>
                {FROM_ACCOUNTS.map((entry) => (
                  <Option value={entry.value} key={entry.value}>
                    {entry.label}
                  </Option>
                ))}
              </Dropdown>
            </FormField>
            <FormField>
              <FormFieldLabel>Payee</FormFieldLabel>
              <Dropdown data-demo-anchor="transfer-payee" selected={[payee]} valueToString={TransferForm_payeeLabel} onSelectionChange={choosePayee}>
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
                <TransferForm_Detail label="From" value={TransferForm_fromLabel(from)} />
                <TransferForm_Detail label="To" value={`${record.name} ••••${record.account}`} />
                <TransferForm_Detail label="Amount" value={usd(value)} />
                <TransferForm_Detail label="Reference" value={reference.trim() || "None"} />
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

type PaymentActivity_Status = PaymentStatus | "Approved";

const PaymentActivity_TONE = {
  Settled: "success",
  Approved: "success",
  "Pending approval": "info",
  Failed: "error",
} as const;

function PaymentActivity_Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Display3 className={styles["PaymentActivity_figure"]}>{value}</Display3>
      <Text color="secondary">{detail}</Text>
    </StackLayout>
  );
}

function PaymentActivity() {
  const approver = useProfile().persona === "Approver";
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [recalculated, setRecalculated] = useState(0);
  const status = (payment: (typeof ACTIVITY)[number]): PaymentActivity_Status => (approved.includes(payment.id) ? "Approved" : payment.status);
  const total = ACTIVITY.reduce((sum, payment) => sum + payment.amount, 0);
  const pending = ACTIVITY.filter((payment) => status(payment) === "Pending approval").length;
  const failed = ACTIVITY.filter((payment) => status(payment) === "Failed").length;

  return (
    <Panel data-demo-anchor="activity-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={1} wrap>
          <H2>Payment activity</H2>
          <Button sentiment="neutral" appearance="bordered" onClick={() => setRecalculated((count) => count + 1)} data-demo-anchor="recalculate-totals">
            <RefreshIcon aria-hidden />
            Recalculate totals
          </Button>
        </FlexLayout>
        <GridLayout columns={{ xs: 1, sm: 3 }} gap={2}>
          <PaymentActivity_Figure label="Sent today (USD)" value={money(total)} detail={`${ACTIVITY.length} payments`} />
          <PaymentActivity_Figure label="Pending approval" value={`${pending}`} detail="Needs an Approver" />
          <PaymentActivity_Figure label="Failed" value={`${failed}`} detail="Retry before 16:00 ET" />
        </GridLayout>
        <Text role="status" color="secondary">
          {recalculated > 0 ? `Totals recalculated ${recalculated === 1 ? "once" : `${recalculated} times`} this session.` : ""}
        </Text>
        <TableContainer>
          <Table aria-label="Today's payments">
            <THead sticky>
              <TR>
                <TH>Payment</TH>
                <TH>Time</TH>
                <TH>Payee</TH>
                <TH textAlign="right">Amount</TH>
                <TH>Status</TH>
                {approver && <TH>Approval</TH>}
              </TR>
            </THead>
            <TBody>
              {ACTIVITY.map((payment) => {
                const current = status(payment);
                return (
                  <TR key={payment.id} data-demo-anchor={`payment-${payment.id}`}>
                    <TD>{payment.id}</TD>
                    <TD className={styles["PaymentActivity_figure"]}>{payment.time}</TD>
                    <TD>{payment.payee}</TD>
                    <TD textAlign="right" className={styles["PaymentActivity_figure"]}>
                      {usd(payment.amount)}
                    </TD>
                    <TD>
                      <FlexLayout gap={1} align="center">
                        <StatusIndicator status={PaymentActivity_TONE[current]} aria-hidden />
                        <Text>{current}</Text>
                      </FlexLayout>
                    </TD>
                    {approver && (
                      <TD>
                        {current === "Pending approval" ? (
                          <Button sentiment="accented" appearance="transparent" onClick={() => setApproved((ids) => [...ids, payment.id])} data-demo-anchor={`approve-${payment.id}`}>
                            {`Approve ${payment.id}`}
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
        {!approver && <Text color="secondary">Approvals are available to the Approver role.</Text>}
      </StackLayout>
    </Panel>
  );
}

export default function PaymentsWorkspace() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <PayeeList />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <TransferForm />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 3 }}>
        <PaymentActivity />
      </GridItem>
    </GridLayout>
  );
}
