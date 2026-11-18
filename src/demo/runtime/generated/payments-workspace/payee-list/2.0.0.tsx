import { usePublish } from "@deweb/portal";
import { Button, FormField, FormFieldLabel, H2, Input, Panel, StackLayout, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { SearchIcon, SendIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { PAYEES, type Payee } from "../data";
import styles from "./2.0.0.module.css";

export default function PayeeList() {
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
                    <TR key={payee.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`payee-${payee.id}`}>
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
