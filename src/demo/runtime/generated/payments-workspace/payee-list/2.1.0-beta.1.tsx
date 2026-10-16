import { useState } from "react";
import {
  Button,
  Card,
  FlexLayout,
  FormField,
  FormFieldLabel,
  GridLayout,
  H2,
  Input,
  Panel,
  StackLayout,
  Tag,
  Text,
} from "@salt-ds/core";
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
  const ordered = [...payees].sort((left, right) => Number(right.favorite) - Number(left.favorite));

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
            placeholder="Name of a payee"
            value={search}
            onChange={(event) => setSearch((event.target as HTMLInputElement).value)}
            inputProps={searchInputProps}
          />
        </FormField>
        <GridLayout columns={{ xs: 1, sm: 2, md: 3 }} gap={2} role="list">
          {ordered.map((payee) => {
            const isSelected = selected === payee.id;
            const content = (
              <StackLayout gap={1} align="start">
                <Text styleAs="label" color="secondary">
                  {payee.favorite ? "Favorite · " : ""}
                  {payee.bank}
                </Text>
                <Text>{payee.name}</Text>
                <Button
                  sentiment="accented"
                  appearance="solid"
                  onClick={() => choose(payee)}
                  data-demo-anchor={`pay-${payee.id}`}
                >
                  {`Pay ${payee.name.split(" ")[0]}`}
                </Button>
              </StackLayout>
            );
            return isSelected ? (
              <Card
                key={payee.id}
                role="listitem"
                data-demo-anchor={`payee-${payee.id}`}
                aria-current="true"
                accent="left"
                style={{ background: "var(--salt-selectable-background-selected)" }}
              >
                {content}
              </Card>
            ) : (
              <Card key={payee.id} role="listitem" data-demo-anchor={`payee-${payee.id}`}>
                {content}
              </Card>
            );
          })}
        </GridLayout>
      </StackLayout>
    </Panel>
  );
}
