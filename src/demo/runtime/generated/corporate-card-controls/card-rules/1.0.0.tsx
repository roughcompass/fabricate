import { useBus } from "@deweb/portal";
import { Button, Checkbox, CheckboxGroup, Display4, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridLayout, H2, H3, NumberInput, Panel, StackLayout, StatusIndicator, Text } from "@salt-ds/core";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { AS_OF, CARDS, type CorporateCard, type MerchantRule, RULES, TRAIL, type TrailEntry } from "../data";
import styles from "./1.0.0.module.css";

const money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const OUTCOME: Record<TrailEntry["outcome"], "success" | "error" | "warning"> = { Approved: "success", Rejected: "error", "Pending approval": "warning" };
const MIN_LIMIT = 500;
const MAX_LIMIT = 100000;
const APPROVER = "Marcus Bell";

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

function RuleForm({ card, rules, onRequest }: { card: CorporateCard; rules: readonly MerchantRule[]; onRequest: (change: string) => void }) {
  const [limit, setLimit] = useState(String(card.limit));
  const [allowed, setAllowed] = useState(rules.filter((rule) => rule.allowed).map((rule) => rule.id));
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState("");

  const toggle = (event: ChangeEvent<HTMLInputElement>) => {
    const { value, checked } = event.target;
    setAllowed((current) => (checked ? [...current, value] : current.filter((id) => id !== value)));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(limit);
    if (!Number.isFinite(amount) || amount < MIN_LIMIT || amount > MAX_LIMIT) {
      setInvalid(true);
      setMessage("");
      return;
    }
    setInvalid(false);
    const changes = [
      ...(amount !== card.limit ? [`Monthly limit ${amount > card.limit ? "raised" : "lowered"} to ${money(card.currency, amount)}`] : []),
      ...rules.filter((rule) => rule.allowed !== allowed.includes(rule.id)).map((rule) => `${rule.label} ${allowed.includes(rule.id) ? "allowed" : "blocked"}`),
    ];
    if (changes.length === 0) {
      setMessage("Nothing has changed yet. Change the limit or a merchant rule to request it.");
      return;
    }
    if (changes.join("|") === sent) {
      setMessage(`Already with ${APPROVER} for approval.`);
      return;
    }
    changes.forEach(onRequest);
    setSent(changes.join("|"));
    setMessage(`Sent to ${APPROVER} for approval. The change applies once it's approved.`);
  };

  return (
    <form onSubmit={submit} aria-labelledby="card-rules-form">
      <StackLayout gap={2}>
        <H3 id="card-rules-form">Limits and merchant rules</H3>
        <FormField validationStatus={invalid ? "error" : undefined}>
          <FormFieldLabel>{`Monthly limit (${card.currency})`}</FormFieldLabel>
          <NumberInput value={limit} onChange={(_event, value) => setLimit(value)} min={MIN_LIMIT} max={MAX_LIMIT} step={500} decimalScale={0} textAlign="right" />
          <FormFieldHelperText>
            {invalid ? `Enter a monthly limit from ${money(card.currency, MIN_LIMIT)} to ${money(card.currency, MAX_LIMIT)}.` : `Changes go to ${APPROVER} before they apply.`}
          </FormFieldHelperText>
        </FormField>
        <FormField>
          <FormFieldLabel>Allowed merchant categories</FormFieldLabel>
          <CheckboxGroup checkedValues={allowed} onChange={toggle}>
            {rules.map((rule) => (
              <Checkbox key={rule.id} value={rule.id} label={rule.label} />
            ))}
          </CheckboxGroup>
        </FormField>
        <FlexLayout gap={2} align="center" wrap>
          <Button type="submit" sentiment="accented">
            Request change
          </Button>
          <Text role="status" color="secondary">
            {message}
          </Text>
        </FlexLayout>
      </StackLayout>
    </form>
  );
}

export default function CardRules() {
  const [id, setId] = useState(CARDS[0]!.id);
  const [requested, setRequested] = useState<Record<string, TrailEntry[]>>({});
  useBus("card:selected", "card-rules", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && CARDS.some((card) => card.id === next)) setId(next);
  });
  const card = CARDS.find((entry) => entry.id === id)!;
  const trail = [...(requested[card.id] ?? []), ...(TRAIL[card.id] ?? [])];

  const request = (change: string) =>
    setRequested((current) => {
      const own = current[card.id] ?? [];
      return { ...current, [card.id]: [{ id: `r${own.length + 1}-${change}`, date: AS_OF, actor: "You", change, outcome: "Pending approval" }, ...own] };
    });

  return (
    <Panel data-demo-anchor="card-rules-panel">
      <StackLayout gap={3}>
        <StackLayout gap={1}>
          <H2>{card.holder}</H2>
          <Text color="secondary">{`Card ••••${card.last4} · ${card.department}`}</Text>
        </StackLayout>
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary">
            Available this month
          </Text>
          <Display4 className={styles.figure}>{money(card.currency, Math.max(0, card.limit - card.spent))}</Display4>
          <Text color="secondary">{`of a ${money(card.currency, card.limit)} monthly limit`}</Text>
        </StackLayout>
        <GridLayout columns={2} gap={2}>
          <Figure label="Spent this month" value={money(card.currency, card.spent)} />
          <Figure label="Per-purchase limit" value={money(card.currency, card.perPurchase)} />
        </GridLayout>
        {card.status === "Frozen" ? (
          <StackLayout gap={1}>
            <H3>Limits and merchant rules</H3>
            <Text color="secondary">This card is frozen, so its limits and rules can't change. The card fraud team unfreezes it once the cardholder confirms their recent purchases.</Text>
          </StackLayout>
        ) : (
          <RuleForm key={card.id} card={card} rules={RULES[card.id] ?? []} onRequest={request} />
        )}
        <StackLayout gap={2} as="section" aria-labelledby="card-rules-trail">
          <H3 id="card-rules-trail">Approval trail</H3>
          {trail.length === 0 ? (
            <Text color="secondary">No changes yet. Requested changes appear here with their approver.</Text>
          ) : (
            <StackLayout as="ol" gap={2} className={styles.list}>
              {trail.map((entry) => (
                <StackLayout as="li" key={entry.id} gap={1}>
                  <Text>{entry.change}</Text>
                  <FlexLayout gap={1} align="center">
                    <StatusIndicator status={OUTCOME[entry.outcome]} />
                    <Text>{entry.outcome}</Text>
                  </FlexLayout>
                  <Text styleAs="label" color="secondary">{`${entry.date} · ${entry.actor}`}</Text>
                </StackLayout>
              ))}
            </StackLayout>
          )}
        </StackLayout>
      </StackLayout>
    </Panel>
  );
}
