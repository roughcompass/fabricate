import { SaltProvider, StackLayout, Text } from "@salt-ds/core";

const QUOTES = [
  { symbol: "ACME", price: "101.20" },
  { symbol: "GLOBEX", price: "48.75" },
  { symbol: "EURUSD", price: "1.0842" },
];

/** The exposed module: a panel of prices inside its own Salt provider, nested in the host's. */
export default function Quotes() {
  return (
    <SaltProvider>
      <section aria-labelledby="quotes-panel-title" data-quotes-panel="" style={{ padding: 16, border: "1px solid var(--salt-separable-primary-borderColor)" }}>
        <StackLayout gap={1}>
          <h2 id="quotes-panel-title">Quotes panel</h2>
          <ul>
            {QUOTES.map((quote) => (
              <li key={quote.symbol}>
                <Text>{`${quote.symbol} ${quote.price}`}</Text>
              </li>
            ))}
          </ul>
        </StackLayout>
      </section>
    </SaltProvider>
  );
}
