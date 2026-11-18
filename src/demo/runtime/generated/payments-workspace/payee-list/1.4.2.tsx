import { usePublish } from "@deweb/portal";
import { Button, FlexLayout, FormField, FormFieldLabel, H2, Input, Panel, StackLayout, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { SearchIcon, SendIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { PAYEES, type Payee } from "../data";
import styles from "./1.4.2.module.css";

export default function PayeeList() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const publish = usePublish("payee-list");
  const search = query.trim().toLowerCase();
  const payees = PAYEES.filter((payee) => payee.name.toLowerCase().includes(search));

  const choose = (payee: Payee) => {
    setSelected(payee.id);
    publish("payee:selected", { id: payee.id, name: payee.name });
  };

  return (
    <Panel data-demo-anchor="payee-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={2} wrap>
          <H2>Payees</H2>
          <FormField labelPlacement="left">
            <FormFieldLabel>Search payees</FormFieldLabel>
            <Input
              startAdornment={<SearchIcon aria-hidden />}
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
              inputProps={{ type: "search", "data-demo-anchor": "payee-search" }}
            />
          </FormField>
        </FlexLayout>
        {payees.length === 0 ? (
          <Text color="secondary">{`No payees match "${query.trim()}". Clear the search to see every payee.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Payees">
              <THead sticky>
                <TR>
                  <TH>Payee</TH>
                  <TH>Account</TH>
                  <TH>Last paid</TH>
                  <TH>Pay</TH>
                </TR>
              </THead>
              <TBody>
                {payees.map((payee) => {
                  const current = payee.id === selected;
                  return (
                    <TR key={payee.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`payee-${payee.id}`}>
                      <TD>
                        <Button sentiment="neutral" appearance="transparent" className={styles.recordName} aria-pressed={current} onClick={() => choose(payee)}>
                          {payee.name}
                        </Button>
                      </TD>
                      <TD>
                        <Text color="secondary">{`${payee.bank} ••••${payee.account}`}</Text>
                      </TD>
                      <TD>{payee.lastPaid}</TD>
                      <TD>
                        <Button sentiment="accented" appearance="transparent" aria-label={`Pay ${payee.name}`} onClick={() => choose(payee)} data-demo-anchor={`pay-${payee.id}`}>
                          <SendIcon aria-hidden />
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
