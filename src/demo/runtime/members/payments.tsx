"use client";

import { useState } from "react";
import { useBusSubscription, usePersona, usePublish } from "../runtime-context";
import { Icon } from "./icons";
import { blockMainThread } from "./planted";
import { Badge, Button, Field, Muted, Panel, Select, Stat, Table, Td, TextInput, Th, Tr, uiStyles } from "./ui";

/** The Payments workspace hero: payee list, transfer form, and payment activity. */

interface Payee {
  id: string;
  name: string;
  bank: string;
  account: string;
  lastPaid: string;
  favorite: boolean;
}

const PAYEES: readonly Payee[] = [
  { id: "northwind", name: "Northwind Supplies", bank: "Harbor Trust", account: "4821", lastPaid: "Sep 24", favorite: true },
  { id: "bluebird", name: "Bluebird Logistics", bank: "First Meridian", account: "1077", lastPaid: "Sep 22", favorite: false },
  { id: "cobalt", name: "Cobalt Office Co.", bank: "Pioneer Savings", account: "3390", lastPaid: "Sep 19", favorite: true },
  { id: "evergreen", name: "Evergreen Facilities", bank: "Harbor Trust", account: "5512", lastPaid: "Sep 12", favorite: false },
  { id: "lumen", name: "Lumen Energy", bank: "Atlas National", account: "8846", lastPaid: "Sep 03", favorite: false },
  { id: "quarry", name: "Quarry Street Legal", bank: "First Meridian", account: "2208", lastPaid: "Aug 28", favorite: false },
];

function usePayeeSearch() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const publish = usePublish("payee-list");
  const payees = PAYEES.filter((payee) => payee.name.toLowerCase().includes(search.trim().toLowerCase()));
  const choose = (payee: Payee) => {
    setSelected(payee.id);
    publish("payee:selected", { id: payee.id, name: payee.name });
  };
  return { search, setSearch, selected, payees, choose };
}

/**
 * PLANTED DEFECTS (payee list 1.4.2): the search has no label (the text above
 * it is not associated with it), account numbers
 * use the deliberately faint token, and the pay buttons are icons with no
 * accessible name. Version 2.0.0 fixes all three.
 */
export function PayeeList142() {
  const { search, setSearch, selected, payees, choose } = usePayeeSearch();
  return (
    <Panel title="Payees" anchor="payee-panel">
      <p className={uiStyles.muted}>Search payees</p>
      <input className={uiStyles.input} type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} data-demo-anchor="payee-search" />
      <Table label="Payees" head={<><Th>Payee</Th><Th>Account</Th><Th>Last paid</Th><Th /></>}>
        {payees.map((payee) => (
          <Tr key={payee.id} selected={selected === payee.id} anchor={`payee-${payee.id}`}>
            <Td>{payee.name}</Td>
            <Td className={uiStyles.defectFaint}>{`${payee.bank} ···· ${payee.account}`}</Td>
            <Td>{payee.lastPaid}</Td>
            <Td>
              <button type="button" className={[uiStyles.button, uiStyles.ghost].join(" ")} onClick={() => choose(payee)} data-demo-anchor={`pay-${payee.id}`}>
                <Icon name="send" />
              </button>
            </Td>
          </Tr>
        ))}
      </Table>
    </Panel>
  );
}

export function PayeeList200() {
  const { search, setSearch, selected, payees, choose } = usePayeeSearch();
  return (
    <Panel title="Payees" anchor="payee-panel">
      <Field id="payee-search" label="Search payees">
        <TextInput id="payee-search" type="search" placeholder="Name of a payee" value={search} onChange={(event) => setSearch(event.currentTarget.value)} anchor="payee-search" />
      </Field>
      <Table label="Payees" head={<><Th>Payee</Th><Th>Account</Th><Th>Last paid</Th><Th>Action</Th></>}>
        {payees.map((payee) => (
          <Tr key={payee.id} selected={selected === payee.id} anchor={`payee-${payee.id}`}>
            <Td>{payee.name}</Td>
            <Td>
              <span className={uiStyles.muted}>{`${payee.bank} ···· ${payee.account}`}</span>
            </Td>
            <Td>{payee.lastPaid}</Td>
            <Td>
              <Button variant="ghost" onClick={() => choose(payee)} anchor={`pay-${payee.id}`} aria-label={`Pay ${payee.name}`}>
                <Icon name="send" />
                Pay
              </Button>
            </Td>
          </Tr>
        ))}
      </Table>
    </Panel>
  );
}

export function PayeeList210Beta() {
  const { search, setSearch, selected, payees, choose } = usePayeeSearch();
  const ordered = [...payees].sort((left, right) => Number(right.favorite) - Number(left.favorite));
  return (
    <Panel title="Payees" anchor="payee-panel" actions={<Badge tone="accent">Preview: favorites first</Badge>}>
      <Field id="payee-search-beta" label="Search payees">
        <TextInput id="payee-search-beta" type="search" placeholder="Name of a payee" value={search} onChange={(event) => setSearch(event.currentTarget.value)} anchor="payee-search" />
      </Field>
      <ul className={uiStyles.stats}>
        {ordered.map((payee) => (
          <li key={payee.id} className={[uiStyles.stat, selected === payee.id && uiStyles.selected].filter(Boolean).join(" ")} data-demo-anchor={`payee-${payee.id}`}>
            <p className={uiStyles.statLabel}>
              {payee.favorite ? "Favorite · " : ""}
              {payee.bank}
            </p>
            <p>{payee.name}</p>
            <Button variant="primary" onClick={() => choose(payee)} anchor={`pay-${payee.id}`}>
              {`Pay ${payee.name.split(" ")[0]}`}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function TransferForm({ withReference }: { withReference: boolean }) {
  const [payee, setPayee] = useState(PAYEES[0]!.id);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  useBusSubscription("payee:selected", "transfer-form", (payload) => {
    const id = (payload as { id?: unknown })?.id;
    if (typeof id === "string" && PAYEES.some((entry) => entry.id === id)) {
      setPayee(id);
      setConfirmation(null);
    }
  });
  const payeeName = PAYEES.find((entry) => entry.id === payee)!.name;
  return (
    <Panel title="New transfer" anchor="transfer-panel">
      <form
        className={uiStyles.stack}
        onSubmit={(event) => {
          event.preventDefault();
          const amount = new FormData(event.currentTarget).get("amount");
          if (withReference && !reviewing) {
            setReviewing(true);
            return;
          }
          setReviewing(false);
          setConfirmation(`Payment of $${amount || "0.00"} to ${payeeName} scheduled for today.`);
        }}
      >
        <Field id="transfer-from" label="From account">
          <Select id="transfer-from" name="from" defaultValue="operating" anchor="transfer-from">
            <option value="operating">Operating ···· 2290</option>
            <option value="payroll">Payroll ···· 7731</option>
          </Select>
        </Field>
        <Field id="transfer-payee" label="Payee">
          <Select id="transfer-payee" name="payee" value={payee} onChange={(event) => setPayee(event.currentTarget.value)} anchor="transfer-payee">
            {PAYEES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="transfer-amount" label="Amount (USD)">
          <TextInput id="transfer-amount" name="amount" inputMode="decimal" placeholder="0.00" anchor="transfer-amount" />
        </Field>
        {withReference && (
          <Field id="transfer-reference" label="Payment reference" hint="Shown on the payee's statement.">
            <TextInput id="transfer-reference" name="reference" anchor="transfer-reference" />
          </Field>
        )}
        {reviewing && <Muted>{`Review: send to ${payeeName} from the selected account. Select Confirm payment to send.`}</Muted>}
        <Button variant="primary" type="submit" anchor="send-payment">
          <Icon name="send" />
          {reviewing ? "Confirm payment" : "Send payment"}
        </Button>
        <p role="status" className={uiStyles.muted}>
          {confirmation ?? ""}
        </p>
      </form>
    </Panel>
  );
}

const ACTIVITY = [
  { id: "PMT-3301", payee: "Northwind Supplies", amount: "12,400.00", status: "Settled" },
  { id: "PMT-3302", payee: "Lumen Energy", amount: "3,180.25", status: "Pending approval" },
  { id: "PMT-3303", payee: "Bluebird Logistics", amount: "8,950.00", status: "Pending approval" },
  { id: "PMT-3304", payee: "Cobalt Office Co.", amount: "642.10", status: "Settled" },
  { id: "PMT-3305", payee: "Quarry Street Legal", amount: "5,000.00", status: "Failed" },
] as const;

const TONES = { Settled: "positive", "Pending approval": "accent", Failed: "negative", Approved: "positive" } as const;

export function PaymentActivity() {
  const persona = usePersona();
  const approver = persona.role === "Approver";
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [recalculated, setRecalculated] = useState<number>(0);
  return (
    <Panel
      title="Payment activity"
      anchor="activity-panel"
      actions={
        <Button
          onClick={() => {
            blockMainThread(650);
            setRecalculated((count) => count + 1);
          }}
          anchor="recalculate-totals"
        >
          <Icon name="refresh" />
          Recalculate totals
        </Button>
      }
    >
      <div className={uiStyles.stats}>
        <Stat label="Sent today" value="$30,172.35" detail="5 payments" />
        <Stat label="Pending approval" value={`${2 - approved.length}`} detail="Needs an Approver" tone="accent" />
        <Stat label="Failed" value="1" detail="Retry before 4 p.m." tone="negative" />
      </div>
      {recalculated > 0 && <Muted>{`Totals recalculated ${recalculated === 1 ? "once" : `${recalculated} times`} this session.`}</Muted>}
      <Table label="Today's payments" head={<><Th>Payment</Th><Th>Payee</Th><Th numeric>Amount</Th><Th>Status</Th>{approver && <Th>Approval</Th>}</>}>
        {ACTIVITY.map((payment) => {
          const status = approved.includes(payment.id) ? "Approved" : payment.status;
          return (
            <Tr key={payment.id} anchor={`payment-${payment.id}`}>
              <Td>{payment.id}</Td>
              <Td>{payment.payee}</Td>
              <Td numeric>{`$${payment.amount}`}</Td>
              <Td>
                <Badge tone={TONES[status]}>{status}</Badge>
              </Td>
              {approver && (
                <Td>
                  {status === "Pending approval" ? (
                    <Button variant="primary" onClick={() => setApproved((ids) => [...ids, payment.id])} anchor={`approve-${payment.id}`}>
                      {`Approve ${payment.id}`}
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
      {!approver && <Muted>Approvals are available to the Approver role.</Muted>}
    </Panel>
  );
}

export const PAYMENTS_MEMBERS = {
  "payee-list": { "1.4.2": PayeeList142, "2.0.0": PayeeList200, "2.1.0-beta.1": PayeeList210Beta },
  "transfer-form": { "3.0.1": () => <TransferForm withReference={false} />, "3.1.0": () => <TransferForm withReference /> },
  "payment-activity": { "2.3.0": PaymentActivity },
} as const;

