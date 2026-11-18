import { usePublish } from "@deweb/portal";
import { Button, FlexLayout, FormField, FormFieldLabel, H2, Input, LinearProgress, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { AS_OF, CARDS, type CardStatus, type CorporateCard } from "../data";
import styles from "./1.1.0.module.css";

const money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Share of the monthly limit spent so far, capped at 100. */
const utilization = (card: CorporateCard) => Math.min(100, Math.round((card.spent / card.limit) * 100));
const STATUS: Record<CardStatus, "success" | "error" | "warning"> = { Active: "success", Frozen: "error", "Change pending": "warning" };

export default function CardList() {
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
                    <TR key={card.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`card-${card.id}`}>
                      <TD>
                        <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(card)}>
                          {card.holder}
                        </Button>
                      </TD>
                      <TD className={styles.figure}>{`••••${card.last4}`}</TD>
                      <TD>{card.department}</TD>
                      <TD textAlign="right" className={styles.figure}>
                        {money(card.currency, card.limit)}
                      </TD>
                      <TD textAlign="right" className={styles.figure}>
                        {money(card.currency, card.spent)}
                      </TD>
                      <TD>
                        <StackLayout gap={1}>
                          <LinearProgress className={styles.meter} value={utilization(card)} hideLabel aria-label={`${card.holder} has spent ${utilization(card)}% of the monthly limit`} />
                          <Text styleAs="label" color="secondary" className={styles.figure}>{`${utilization(card)}% of limit`}</Text>
                        </StackLayout>
                      </TD>
                      <TD>
                        <FlexLayout gap={1} align="center" wrap={false}>
                          <StatusIndicator status={STATUS[card.status]} />
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
