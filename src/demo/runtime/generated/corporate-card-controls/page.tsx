// Corporate card controls: the Cards route as one page, composed from its microfrontends at their conformant versions:
// card-list 1.1.0 (main)
// card-rules 1.0.0 (side)
import { useBus, usePublish } from "@deweb/portal";
import { Button, Checkbox, CheckboxGroup, Display4, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridItem, GridLayout, H2, H3, Input, LinearProgress, NumberInput, Panel, StackLayout, StatusIndicator, Table, TableContainer, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { AS_OF, CARDS, type CardStatus, type CorporateCard, type MerchantRule, RULES, TRAIL, type TrailEntry } from "./data";
import styles from "./page.module.css";

const CardList_money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CardList_utilization = (card: CorporateCard) => Math.min(100, Math.round((card.spent / card.limit) * 100));

const CardList_STATUS: Record<CardStatus, "success" | "error" | "warning"> = { Active: "success", Frozen: "error", "Change pending": "warning" };

function CardList() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(CARDS[0]!.id);
  const publish = usePublish("card-list");
  const search = query.trim().toLowerCase();
  const rows = CARDS.filter((card) => card.holder.toLowerCase().includes(search) || card.department.toLowerCase().includes(search) || card.last4.includes(search));

  const choose = (card: CorporateCard) => {
    setSelected(card.id);
    publish("card:selected", { id: card.id, name: card.holder });
  };

  return (
    <Panel data-demo-anchor="card-list-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Corporate cards</H2>
          <Text styleAs="label" color="secondary">{`Spend this month, as of ${AS_OF}`}</Text>
        </FlexLayout>
        <FormField>
          <FormFieldLabel>Find a card</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="Cardholder, department, or last 4 digits"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "card-search" }}
          />
        </FormField>
        {rows.length === 0 ? (
          <Text color="secondary">{`No cards match "${query.trim()}". Clear the search to see every card.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Corporate cards">
              <THead sticky>
                <TR>
                  <TH>Cardholder</TH>
                  <TH>Card</TH>
                  <TH>Department</TH>
                  <TH textAlign="right">Monthly limit</TH>
                  <TH textAlign="right">Spent this month</TH>
                  <TH>Utilization</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((card) => {
                  const current = card.id === selected;
                  return (
                    <TR key={card.id} aria-current={current ? "true" : undefined} className={current ? styles["CardList_selected"] : undefined} data-demo-anchor={`card-${card.id}`}>
                      <TD>
                        <Button sentiment="neutral" appearance="transparent" className={styles["CardList_recordName"]} aria-pressed={current} onClick={() => choose(card)}>
                          {card.holder}
                        </Button>
                      </TD>
                      <TD className={styles["CardList_figure"]}>{`••••${card.last4}`}</TD>
                      <TD>{card.department}</TD>
                      <TD textAlign="right" className={styles["CardList_figure"]}>
                        {CardList_money(card.currency, card.limit)}
                      </TD>
                      <TD textAlign="right" className={styles["CardList_figure"]}>
                        {CardList_money(card.currency, card.spent)}
                      </TD>
                      <TD>
                        <StackLayout gap={1}>
                          <LinearProgress className={styles["CardList_meter"]} value={CardList_utilization(card)} hideLabel aria-label={`${card.holder} has spent ${CardList_utilization(card)}% of the monthly limit`} />
                          <Text styleAs="label" color="secondary" className={styles["CardList_figure"]}>{`${CardList_utilization(card)}% of limit`}</Text>
                        </StackLayout>
                      </TD>
                      <TD>
                        <FlexLayout gap={1} align="center" wrap={false}>
                          <StatusIndicator status={CardList_STATUS[card.status]} />
                          <Text>{card.status}</Text>
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

const CardRules_money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CardRules_OUTCOME: Record<TrailEntry["outcome"], "success" | "error" | "warning"> = { Approved: "success", Rejected: "error", "Pending approval": "warning" };

const CardRules_MIN_LIMIT = 500;

const CardRules_MAX_LIMIT = 100000;

const CardRules_APPROVER = "Marcus Bell";

function CardRules_Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text className={styles["CardRules_figure"]}>{value}</Text>
    </StackLayout>
  );
}

function CardRules_RuleForm({ card, rules, onRequest }: { card: CorporateCard; rules: readonly MerchantRule[]; onRequest: (change: string) => void }) {
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
    if (!Number.isFinite(amount) || amount < CardRules_MIN_LIMIT || amount > CardRules_MAX_LIMIT) {
      setInvalid(true);
      setMessage("");
      return;
    }
    setInvalid(false);
    const changes = [
      ...(amount !== card.limit ? [`Monthly limit ${amount > card.limit ? "raised" : "lowered"} to ${CardRules_money(card.currency, amount)}`] : []),
      ...rules.filter((rule) => rule.allowed !== allowed.includes(rule.id)).map((rule) => `${rule.label} ${allowed.includes(rule.id) ? "allowed" : "blocked"}`),
    ];
    if (changes.length === 0) {
      setMessage("Nothing has changed yet. Change the limit or a merchant rule to request it.");
      return;
    }
    if (changes.join("|") === sent) {
      setMessage(`Already with ${CardRules_APPROVER} for approval.`);
      return;
    }
    changes.forEach(onRequest);
    setSent(changes.join("|"));
    setMessage(`Sent to ${CardRules_APPROVER} for approval. The change applies once it's approved.`);
  };

  return (
    <form onSubmit={submit} aria-labelledby="card-rules-form">
      <StackLayout gap={2}>
        <H3 id="card-rules-form">Limits and merchant rules</H3>
        <FormField validationStatus={invalid ? "error" : undefined}>
          <FormFieldLabel>{`Monthly limit (${card.currency})`}</FormFieldLabel>
          <NumberInput value={limit} onChange={(_event, value) => setLimit(value)} min={CardRules_MIN_LIMIT} max={CardRules_MAX_LIMIT} step={500} decimalScale={0} textAlign="right" />
          <FormFieldHelperText>
            {invalid ? `Enter a monthly limit from ${CardRules_money(card.currency, CardRules_MIN_LIMIT)} to ${CardRules_money(card.currency, CardRules_MAX_LIMIT)}.` : `Changes go to ${CardRules_APPROVER} before they apply.`}
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

function CardRules() {
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
          <Display4 className={styles["CardRules_figure"]}>{CardRules_money(card.currency, Math.max(0, card.limit - card.spent))}</Display4>
          <Text color="secondary">{`of a ${CardRules_money(card.currency, card.limit)} monthly limit`}</Text>
        </StackLayout>
        <GridLayout columns={2} gap={2}>
          <CardRules_Figure label="Spent this month" value={CardRules_money(card.currency, card.spent)} />
          <CardRules_Figure label="Per-purchase limit" value={CardRules_money(card.currency, card.perPurchase)} />
        </GridLayout>
        {card.status === "Frozen" ? (
          <StackLayout gap={1}>
            <H3>Limits and merchant rules</H3>
            <Text color="secondary">This card is frozen, so its limits and rules can't change. The card fraud team unfreezes it once the cardholder confirms their recent purchases.</Text>
          </StackLayout>
        ) : (
          <CardRules_RuleForm key={card.id} card={card} rules={RULES[card.id] ?? []} onRequest={request} />
        )}
        <StackLayout gap={2} as="section" aria-labelledby="card-rules-trail">
          <H3 id="card-rules-trail">Approval trail</H3>
          {trail.length === 0 ? (
            <Text color="secondary">No changes yet. Requested changes appear here with their approver.</Text>
          ) : (
            <StackLayout as="ol" gap={2} className={styles["CardRules_list"]}>
              {trail.map((entry) => (
                <StackLayout as="li" key={entry.id} gap={1}>
                  <Text>{entry.change}</Text>
                  <FlexLayout gap={1} align="center">
                    <StatusIndicator status={CardRules_OUTCOME[entry.outcome]} />
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

export default function CorporateCardControls() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <CardList />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <CardRules />
      </GridItem>
    </GridLayout>
  );
}
