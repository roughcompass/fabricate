import { useState } from "react";
import {
  Button,
  FormField,
  FormFieldLabel,
  H2,
  Input,
  Panel,
  StackLayout,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Text,
} from "@salt-ds/core";
import { SendIcon } from "@salt-ds/icons";
import { usePublish } from "@deweb/portal";
import { PAYEES, type Payee } from "../data";

const searchInputProps = {
  type: "search",
  "data-demo-anchor": "payee-search",
};

export default function PayeeList() {
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
            inputProps={searchInputProps}
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
