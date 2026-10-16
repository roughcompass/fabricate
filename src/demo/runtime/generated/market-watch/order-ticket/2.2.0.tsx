import { useState } from "react";
import {
  Button,
  Dropdown,
  FormField,
  FormFieldLabel,
  GridLayout,
  GridItem,
  H2,
  Input,
  Option,
  Panel,
  StackLayout,
  Text,
} from "@salt-ds/core";
import { useBus } from "@deweb/portal";
import { INSTRUMENTS } from "../data";

const MEMBER = "order-ticket";

const instrument = (symbol: string) => INSTRUMENTS.find((entry) => entry.symbol === symbol);

const SIDES: Record<string, string> = { buy: "Buy", sell: "Sell" };
const TYPES: Record<string, string> = { limit: "Limit", market: "Market" };

export default function OrderTicket() {
  const [symbol, setSymbol] = useState<string>(INSTRUMENTS[0]!.symbol);
  const [side, setSide] = useState("buy");
  const [type, setType] = useState("limit");
  const [quantity, setQuantity] = useState("");
  const [limit, setLimit] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  useBus("instrument:selected", MEMBER, (payload: unknown) => {
    const next = (payload as { symbol?: unknown })?.symbol;
    if (typeof next === "string" && instrument(next)) setSymbol(next);
  });

  const entry = instrument(symbol)!;

  return (
    <Panel data-demo-anchor="order-panel">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(
            `${side === "sell" ? "Sell" : "Buy"} ${quantity || 0} ${symbol} at ${
              type === "market" ? "market" : `limit ${limit || entry.price.toFixed(2)}`
            } submitted.`,
          );
        }}
      >
        <StackLayout gap={2}>
          <StackLayout gap={0.5}>
            <Text styleAs="label" color="secondary">
              <H2 styleAs="label">Order ticket</H2>
            </Text>
            <Text styleAs="h3" data-demo-anchor="order-symbol">
              {`${entry.symbol} · ${entry.name}`}
            </Text>
          </StackLayout>

          <GridLayout columns={2} gap={1}>
            <GridItem>
              <FormField>
                <FormFieldLabel>Side</FormFieldLabel>
                <Dropdown
                  data-demo-anchor="order-side"
                  selected={[side]}
                  valueToString={(item) => SIDES[item] ?? item}
                  onSelectionChange={(_event, next) => {
                    if (next[0]) setSide(next[0]);
                  }}
                >
                  <Option value="buy">Buy</Option>
                  <Option value="sell">Sell</Option>
                </Dropdown>
              </FormField>
            </GridItem>
            <GridItem>
              <FormField>
                <FormFieldLabel>Order type</FormFieldLabel>
                <Dropdown
                  data-demo-anchor="order-type"
                  selected={[type]}
                  valueToString={(item) => TYPES[item] ?? item}
                  onSelectionChange={(_event, next) => {
                    if (next[0]) setType(next[0]);
                  }}
                >
                  <Option value="limit">Limit</Option>
                  <Option value="market">Market</Option>
                </Dropdown>
              </FormField>
            </GridItem>
          </GridLayout>

          <FormField>
            <FormFieldLabel>Quantity</FormFieldLabel>
            <Input
              data-demo-anchor="order-quantity"
              placeholder="100"
              value={quantity}
              onChange={(event) => setQuantity((event.target as HTMLInputElement).value)}
              inputProps={{ name: "quantity", inputMode: "numeric" }}
            />
          </FormField>

          <FormField>
            <FormFieldLabel>Limit price</FormFieldLabel>
            <Input
              data-demo-anchor="order-limit"
              placeholder={entry.price.toFixed(2)}
              value={limit}
              onChange={(event) => setLimit((event.target as HTMLInputElement).value)}
              inputProps={{ name: "limit", inputMode: "decimal" }}
            />
          </FormField>

          <Button sentiment="accented" appearance="solid" type="submit" data-demo-anchor="submit-order">
            Submit order
          </Button>

          <Text role="status" color="secondary">
            {submitted ?? ""}
          </Text>
        </StackLayout>
      </form>
    </Panel>
  );
}
