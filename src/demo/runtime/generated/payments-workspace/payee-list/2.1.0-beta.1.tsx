import { usePublish } from "@deweb/portal";
import { Button, Card, FlexLayout, FormField, FormFieldLabel, GridItem, GridLayout, H2, Input, Panel, StackLayout, Tag, Text } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { PAYEES, type Payee } from "../data";
import styles from "./2.1.0-beta.1.module.css";

export default function PayeeList() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const publish = usePublish("payee-list");
  const search = query.trim().toLowerCase();
  const payees = PAYEES.filter((payee) => payee.name.toLowerCase().includes(search) || payee.bank.toLowerCase().includes(search)).sort((left, right) => Number(right.favorite) - Number(left.favorite));

  const choose = (payee: Payee) => {
    setSelected(payee.id);
    publish("payee:selected", { id: payee.id, name: payee.name });
  };

  return (
    <Panel data-demo-anchor="payee-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={1} wrap>
          <H2>Payees</H2>
          <Tag>Preview: favorites first</Tag>
        </FlexLayout>
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
          <GridLayout as="ul" columns={{ xs: 1, sm: 2, lg: 3 }} gap={2} aria-label="Payees" className={styles.list}>
            {payees.map((payee) => {
              const current = payee.id === selected;
              return (
                <GridItem as="li" key={payee.id}>
                  <Card accent={current ? "left" : undefined} aria-current={current ? "true" : undefined} data-demo-anchor={`payee-${payee.id}`}>
                    <StackLayout gap={1} align="start">
                      <Text styleAs="label" color="secondary">
                        {payee.favorite ? `Favorite · ${payee.bank}` : payee.bank}
                      </Text>
                      <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(payee)}>
                        {payee.name}
                      </Button>
                      <Text styleAs="label" color="secondary">{`••••${payee.account} · Last paid ${payee.lastPaid}`}</Text>
                      <Button sentiment="accented" appearance="bordered" onClick={() => choose(payee)} data-demo-anchor={`pay-${payee.id}`}>
                        {`Pay ${payee.name.split(" ")[0]}`}
                      </Button>
                    </StackLayout>
                  </Card>
                </GridItem>
              );
            })}
          </GridLayout>
        )}
      </StackLayout>
    </Panel>
  );
}
