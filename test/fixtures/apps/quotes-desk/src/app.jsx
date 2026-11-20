import { Component, Suspense, lazy, useEffect, useState } from "react";
import { Button, SaltProvider, StackLayout, Text } from "@salt-ds/core";
import "@salt-ds/theme/index.css";
import { Link, useRoute } from "./router.jsx";

// The remote's exposed module, from wherever its container entry loads.
const Quotes = lazy(() => import("quotesPanel/Quotes"));

const SYMBOLS = ["ACME", "GLOBEX", "INITECH"];

class Unavailable extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p data-quotes-unavailable="">Quotes unavailable</p> : this.props.children;
  }
}

/** The startup line: what the desk read as it started. */
function Startup() {
  const startup = window.__quotesDeskStartup ?? {};
  const shown = (value) => value ?? "none";
  return (
    <dl aria-label="Started with" data-startup="" style={{ display: "flex", gap: 24, margin: 0 }}>
      <div>
        <dt>User</dt>
        <dd data-startup-user="">{shown(startup.user)}</dd>
      </div>
      <div>
        <dt>Region</dt>
        <dd data-startup-region="">{shown(startup.region)}</dd>
      </div>
      <div>
        <dt>Tab</dt>
        <dd data-startup-tab="">{shown(startup.tab)}</dd>
      </div>
      <div>
        <dt>Desk</dt>
        <dd data-startup-desk="">{shown(startup.desk)}</dd>
      </div>
    </dl>
  );
}

/** The quote list: choosing a quote announces it on the window, and the desk shows whatever was announced. */
function Desk() {
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    const onSelected = (event) => setSelected(event.detail?.symbol ?? null);
    window.addEventListener("quotes:selected", onSelected);
    return () => window.removeEventListener("quotes:selected", onSelected);
  }, []);
  return (
    <StackLayout gap={2}>
      <h1>Quotes desk</h1>
      <Startup />
      <div role="group" aria-label="Quotes" style={{ display: "flex", gap: 8 }}>
        {SYMBOLS.map((symbol) => (
          <Button key={symbol} onClick={() => window.dispatchEvent(new CustomEvent("quotes:selected", { detail: { symbol } }))}>
            {symbol}
          </Button>
        ))}
      </div>
      <Text data-selected="">{`Selected: ${selected ?? "none"}`}</Text>
      <Unavailable>
        <Suspense fallback={<p>Loading quotes…</p>}>
          <Quotes />
        </Suspense>
      </Unavailable>
    </StackLayout>
  );
}

function Blotter() {
  return (
    <StackLayout gap={2}>
      <h1>Blotter</h1>
      <table>
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col">Side</th>
            <th scope="col">Quantity</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>ACME</td>
            <td>Buy</td>
            <td>1,000</td>
          </tr>
          <tr>
            <td>GLOBEX</td>
            <td>Sell</td>
            <td>250</td>
          </tr>
        </tbody>
      </table>
    </StackLayout>
  );
}

export function App() {
  const route = useRoute();
  return (
    <SaltProvider>
      <header style={{ display: "flex", gap: 24, padding: "12px 24px" }}>
        <nav aria-label="Main" style={{ display: "flex", gap: 16 }}>
          <Link to="/" aria-current={route === "/" ? "page" : undefined}>
            Desk
          </Link>
          <Link to="/blotter" aria-current={route === "/blotter" ? "page" : undefined}>
            Blotter
          </Link>
        </nav>
      </header>
      <main style={{ padding: "0 24px 24px" }}>{route === "/blotter" ? <Blotter /> : <Desk />}</main>
    </SaltProvider>
  );
}
