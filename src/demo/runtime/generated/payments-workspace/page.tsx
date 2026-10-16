// Payments workspace: the Payees route as one page, composed from its microfrontends at their conformant versions:
// payee-list 2.0.0 (main)
// transfer-form 3.1.0 (side)
// payment-activity 2.3.0 (wide)
import { planted, useBus, useProfile, usePublish } from "@deweb/portal";
import { Button, Card, Display3, Divider, Dropdown, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridItem, GridLayout, H2, Input, Label, Option, Panel, StackLayout, StatusIndicator, Table, TableContainer, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { RefreshIcon, SendIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { ACTIVITY, type Payee, PAYEES } from "./data";

const PayeeList_searchInputProps = {
  type: "search",
  "data-demo-anchor": "payee-search",
};

function PayeeList() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const publish = usePublish("payee-list");

  const query = search.trim().toLowerCase();
  const payees = PAYEES.filter((payee) => payee.name.toLowerCase().includes(query));

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
            placeholder="Name of a payee"
            value={search}
            onChange={(event) => setSearch((event.target as HTMLInputElement).value)}
            inputProps={PayeeList_searchInputProps}
          />
        </FormField>
        <TableContainer>
          <Table aria-label="Payees">
            <THead>
              <TR>
                <TH>Payee</TH>
                <TH>Account</TH>
                <TH>Last paid</TH>
                <TH>Action</TH>
              </TR>
            </THead>
            <TBody>
              {payees.map((payee) => {
                const isSelected = selected === payee.id;
                const cells = (
                  <>
                    <TD>
                      <Text>{payee.name}</Text>
                    </TD>
                    <TD>
                      <Text color="secondary">{`${payee.bank} ···· ${payee.account}`}</Text>
                    </TD>
                    <TD>
                      <Text>{payee.lastPaid}</Text>
                    </TD>
                    <TD>
                      <Button
                        appearance="transparent"
                        onClick={() => choose(payee)}
                        data-demo-anchor={`pay-${payee.id}`}
                        aria-label={`Pay ${payee.name}`}
                      >
                        <SendIcon aria-hidden />
                        Pay
                      </Button>
                    </TD>
                  </>
                );
                return isSelected ? (
                  <TR
                    key={payee.id}
                    data-demo-anchor={`payee-${payee.id}`}
                    aria-current="true"
                    style={{ background: "var(--salt-selectable-background-selected)" }}
                  >
                    {cells}
                  </TR>
                ) : (
                  <TR key={payee.id} data-demo-anchor={`payee-${payee.id}`}>
                    {cells}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>
      </StackLayout>
    </Panel>
  );
}

const TransferForm_FROM_ACCOUNTS = [
  { value: "operating", label: "Operating ···· 2290" },
  { value: "payroll", label: "Payroll ···· 7731" },
] as const;

const TransferForm_fromLabel = (value: string) =>
  TransferForm_FROM_ACCOUNTS.find((entry) => entry.value === value)?.label ?? value;

const TransferForm_payeeLabel = (id: string) =>
  PAYEES.find((entry) => entry.id === id)?.name ?? id;

function TransferForm() {
  const [payee, setPayee] = useState<string>(PAYEES[0]!.id);
  const [from, setFrom] = useState<string>("operating");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  useBus("payee:selected", "transfer-form", (payload: unknown) => {
    const id = (payload as { id?: unknown })?.id;
    if (typeof id === "string" && PAYEES.some((entry) => entry.id === id)) {
      setPayee(id);
      setConfirmation(null);
    }
  });

  const record = PAYEES.find((entry) => entry.id === payee)!;
  const payeeName = record.name;
  const submitLabel = reviewing ? "Confirm payment" : "Send payment";

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
            if (!reviewing) {
              setReviewing(true);
              return;
            }
            setReviewing(false);
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
                valueToString={TransferForm_fromLabel}
                onSelectionChange={(_event, selected) => {
                  if (selected[0]) setFrom(selected[0]);
                }}
              >
                {TransferForm_FROM_ACCOUNTS.map((entry) => (
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
                valueToString={TransferForm_payeeLabel}
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

            <FormField>
              <FormFieldLabel>Payment reference</FormFieldLabel>
              <Input
                data-demo-anchor="transfer-reference"
                value={reference}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setReference(event.target.value)
                }
                inputProps={{ name: "reference" }}
              />
              <FormFieldHelperText>Shown on the payee's statement.</FormFieldHelperText>
            </FormField>

            {reviewing && (
              <Text color="secondary">
                {`Review: send to ${payeeName} from the selected account. Select Confirm payment to send.`}
              </Text>
            )}

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

type PaymentActivity_Status = "Settled" | "Pending approval" | "Failed" | "Approved";

const PaymentActivity_STATUS_INDICATOR = {
  Settled: "success",
  "Pending approval": "info",
  Failed: "error",
  Approved: "success",
} as const;

function PaymentActivity_StatusCell({ status }: { status: PaymentActivity_Status }) {
  return (
    <FlexLayout gap={1} align="center">
      <StatusIndicator status={PaymentActivity_STATUS_INDICATOR[status]} />
      <Text>{status}</Text>
    </FlexLayout>
  );
}

function PaymentActivity_Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "info" | "error";
}) {
  return (
    <Card>
      <StackLayout gap={1}>
        <FlexLayout gap={1} align="center">
          {tone && <StatusIndicator status={tone} />}
          <Text color="secondary">{label}</Text>
        </FlexLayout>
        <Display3>{value}</Display3>
        <Text color="secondary" styleAs="label">
          {detail}
        </Text>
      </StackLayout>
    </Card>
  );
}

function PaymentActivity() {
  const approver = useProfile().persona === "Approver";
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [recalculated, setRecalculated] = useState<number>(0);

  return (
    <Panel data-demo-anchor="activity-panel">
      <StackLayout gap={3}>
        <FlexLayout justify="space-between" align="center" wrap gap={2}>
          <H2>Payment activity</H2>
          <Button
            sentiment="neutral"
            appearance="bordered"
            onClick={() => {
              planted.blockMainThread(650);
              setRecalculated((count) => count + 1);
            }}
            data-demo-anchor="recalculate-totals"
          >
            <RefreshIcon aria-hidden />
            Recalculate totals
          </Button>
        </FlexLayout>

        <GridLayout columns="repeat(auto-fit, minmax(calc(var(--salt-size-base) * 9), 1fr))" gap={2}>
          <PaymentActivity_Metric label="Sent today" value="$30,172.35" detail="5 payments" />
          <PaymentActivity_Metric
            label="Pending approval"
            value={`${2 - approved.length}`}
            detail="Needs an Approver"
            tone="info"
          />
          <PaymentActivity_Metric label="Failed" value="1" detail="Retry before 4 p.m." tone="error" />
        </GridLayout>

        {recalculated > 0 && (
          <Text color="secondary">
            {`Totals recalculated ${recalculated === 1 ? "once" : `${recalculated} times`} this session.`}
          </Text>
        )}

        <TableContainer>
          <Table aria-label="Today's payments">
            <THead>
              <TR>
                <TH>Payment</TH>
                <TH>Payee</TH>
                <TH style={{ textAlign: "right" }}>Amount</TH>
                <TH>Status</TH>
                {approver && <TH>Approval</TH>}
              </TR>
            </THead>
            <TBody>
              {ACTIVITY.map((payment) => {
                const status: PaymentActivity_Status = approved.includes(payment.id)
                  ? "Approved"
                  : payment.status;
                return (
                  <TR key={payment.id} data-demo-anchor={`payment-${payment.id}`}>
                    <TD>{payment.id}</TD>
                    <TD>{payment.payee}</TD>
                    <TD style={{ textAlign: "right" }}>{`$${payment.amount}`}</TD>
                    <TD>
                      <PaymentActivity_StatusCell status={status} />
                    </TD>
                    {approver && (
                      <TD>
                        {status === "Pending approval" ? (
                          <Button
                            sentiment="accented"
                            appearance="solid"
                            onClick={() =>
                              setApproved((ids) => [...ids, payment.id])
                            }
                            data-demo-anchor={`approve-${payment.id}`}
                          >
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

        {!approver && (
          <Text color="secondary">Approvals are available to the Approver role.</Text>
        )}
      </StackLayout>
    </Panel>
  );
}

export default function PaymentsWorkspace() {
  return (
    <GridLayout columns={3} gap={3}>
      <GridItem colSpan={2}>
        <PayeeList />
      </GridItem>
      <GridItem colSpan={1}>
        <TransferForm />
      </GridItem>
      <GridItem colSpan={3}>
        <PaymentActivity />
      </GridItem>
    </GridLayout>
  );
}
