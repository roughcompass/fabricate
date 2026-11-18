import { useBus } from "@deweb/portal";
import { Button, Dropdown, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridLayout, H2, NumberInput, Option, Panel, StackLayout, Text } from "@salt-ds/core";
import { type FormEvent, type SyntheticEvent, useState } from "react";
import { INSTRUMENTS } from "../data";
import styles from "./2.2.0.module.css";

const MEMBER = "order-ticket";

const instrument = (symbol: string) => INSTRUMENTS.find((entry) => entry.symbol === symbol);
const usd = (value: number) => `USD ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SIDES: Record<string, string> = { buy: "Buy", sell: "Sell" };
const TYPES: Record<string, string> = { limit: "Limit", market: "Market" };

export default function OrderTicket() {
  const [symbol, setSymbol] = useState<string>(INSTRUMENTS[0]!.symbol);
  const [side, setSide] = useState("buy");
  const [type, setType] = useState("limit");
  const [quantity, setQuantity] = useState("");
  const [limit, setLimit] = useState("");
  const [checked, setChecked] = useState(false);
  const [submitted, setSubmitted] = useState("");

  useBus("instrument:selected", MEMBER, (payload: unknown) => {
    const next = (payload as { symbol?: unknown } | null)?.symbol;
    if (typeof next === "string" && instrument(next)) {
      setSymbol(next);
      setSubmitted("");
    }
  });

  const entry = instrument(symbol)!;
  const market = type === "market";
  const shares = Number(quantity);
  const quantityValid = Number.isInteger(shares) && shares > 0;
  const price = market ? entry.price : Number(limit || entry.price);
  const priceValid = market || (Number.isFinite(price) && price > 0);
  const quantityError = checked && !quantityValid;
  const priceError = checked && !priceValid;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecked(true);
    if (!quantityValid || !priceValid) {
      setSubmitted("");
      return;
    }
    setChecked(false);
    setSubmitted(`${SIDES[side]} ${shares.toLocaleString("en-US")} ${symbol} at ${market ? "market" : `limit ${usd(price)}`} submitted.`);
  };

  return (
    <Panel data-demo-anchor="order-panel">
      <form onSubmit={submit} noValidate>
        <StackLayout gap={2}>
          <StackLayout gap={1}>
            <H2>Order ticket</H2>
            <Text fontWeight="bolder" data-demo-anchor="order-symbol">
              {`${entry.symbol} · ${entry.name}`}
            </Text>
            <Text styleAs="label" color="secondary" className={styles.figure}>{`Last ${usd(entry.price)}`}</Text>
          </StackLayout>

          <GridLayout columns={{ xs: 1, sm: 2, md: 1, xl: 2 }} gap={2}>
            <FormField>
              <FormFieldLabel>Side</FormFieldLabel>
              <Dropdown
                data-demo-anchor="order-side"
                selected={[side]}
                valueToString={(item: string) => SIDES[item] ?? item}
                onSelectionChange={(_event: SyntheticEvent, next: string[]) => {
                  if (next[0]) setSide(next[0]);
                }}
              >
                <Option value="buy">Buy</Option>
                <Option value="sell">Sell</Option>
              </Dropdown>
            </FormField>
            <FormField>
              <FormFieldLabel>Order type</FormFieldLabel>
              <Dropdown
                data-demo-anchor="order-type"
                selected={[type]}
                valueToString={(item: string) => TYPES[item] ?? item}
                onSelectionChange={(_event: SyntheticEvent, next: string[]) => {
                  if (next[0]) setType(next[0]);
                }}
              >
                <Option value="limit">Limit</Option>
                <Option value="market">Market</Option>
              </Dropdown>
            </FormField>
          </GridLayout>

          <FormField validationStatus={quantityError ? "error" : undefined}>
            <FormFieldLabel>Quantity</FormFieldLabel>
            <NumberInput
              data-demo-anchor="order-quantity"
              placeholder="100"
              min={1}
              step={100}
              decimalScale={0}
              value={quantity}
              onChange={(_event: SyntheticEvent | null, value: string) => setQuantity(value)}
              inputProps={{ name: "quantity" }}
            />
            <FormFieldHelperText>{quantityError ? "Enter a whole number of shares, 1 or more." : "Shares, in whole numbers."}</FormFieldHelperText>
          </FormField>

          <FormField disabled={market} validationStatus={priceError ? "error" : undefined}>
            <FormFieldLabel>Limit price (USD)</FormFieldLabel>
            <NumberInput
              data-demo-anchor="order-limit"
              placeholder={entry.price.toFixed(2)}
              min={0.01}
              step={0.01}
              decimalScale={2}
              hideButtons
              value={market ? "" : limit}
              onChange={(_event: SyntheticEvent | null, value: string) => setLimit(value)}
              inputProps={{ name: "limit" }}
            />
            <FormFieldHelperText>{market ? "A market order fills at the best available price." : priceError ? "Enter a price above 0, or leave it blank to use the last price." : "Leave blank to use the last price."}</FormFieldHelperText>
          </FormField>

          <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
            <Text styleAs="label" color="secondary">
              Estimated value
            </Text>
            <Text className={styles.figure}>{quantityValid && priceValid ? usd(shares * price) : "—"}</Text>
          </FlexLayout>

          <Button sentiment="accented" appearance="solid" type="submit" data-demo-anchor="submit-order">
            Submit order
          </Button>

          <Text role="status" color="secondary">
            {submitted}
          </Text>
        </StackLayout>
      </form>
    </Panel>
  );
}
