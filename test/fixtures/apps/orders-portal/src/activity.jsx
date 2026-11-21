import { useEffect, useState } from "react";
import { exportStatus, liveOrders, loadAccount, loadRecentOrders, refreshRecentOrders, searchOrders, startExport, ticker } from "./api.js";

// What the Accounts page reads from the orders API. Each part shows its own
// state while it loads, and says it's unavailable when its call fails.

export const dollars = (amount) => `$${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

const capitalized = (text) => (text ? `${text[0].toUpperCase()}${text.slice(1)}` : "");

/** Runs +load+ once the component mounts, and gives its state. */
function useLoad(load) {
  const [state, setState] = useState({ status: "loading" });
  const [loader] = useState(() => load);
  useEffect(() => {
    let current = true;
    loader().then(
      (data) => current && setState({ status: "ready", data }),
      () => current && setState({ status: "failed" }),
    );
    return () => {
      current = false;
    };
  }, [loader]);
  return [state, setState];
}

export function RecentOrders() {
  const [state, setState] = useLoad(loadRecentOrders);
  const refresh = () => {
    setState({ status: "loading" });
    refreshRecentOrders().then(
      (data) => setState({ status: "ready", data }),
      () => setState({ status: "failed" }),
    );
  };
  return (
    <section className="panel" aria-labelledby="recent-orders">
      <h2 id="recent-orders">Recent orders</h2>
      {state.status === "loading" && <p>Loading recent orders…</p>}
      {state.status === "failed" && <p className="unavailable">Recent orders unavailable</p>}
      {state.status === "ready" && (
        <ul className="orders" data-recent-orders="">
          {(state.data.orders ?? []).map((order) => (
            <li key={order.id}>{`Order ${order.id} · ${order.account} · ${capitalized(order.status)} · ${dollars(order.total)}`}</li>
          ))}
        </ul>
      )}
      <button type="button" className="secondary" onClick={refresh}>
        Refresh
      </button>
    </section>
  );
}

/** An account's orders. Render it with the account's ID as its key, so another account loads its own. */
export function AccountOrders({ id }) {
  const [state] = useLoad(() => loadAccount(id));
  if (state.status === "loading") return <p>Loading orders…</p>;
  if (state.status === "failed") return <p className="unavailable">Account orders unavailable</p>;
  return (
    <ul className="orders" aria-label="Account orders" data-account-orders="">
      {(state.data.orders ?? []).map((order) => (
        <li key={order.id}>{`Order ${order.id} · ${capitalized(order.status)} · ${dollars(order.total)}`}</li>
      ))}
    </ul>
  );
}

export function LiveOrders() {
  const [orders, setOrders] = useState([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const source = liveOrders();
    source.onmessage = (event) => {
      try {
        const order = JSON.parse(event.data);
        setOrders((shown) => [order, ...shown].slice(0, 5));
      } catch {
        // Not an order: nothing to show.
      }
    };
    // A stream that fails or ends isn't opened again.
    source.onerror = () => {
      source.close();
      setFailed(true);
    };
    return () => source.close();
  }, []);
  return (
    <section className="panel" aria-labelledby="live-orders">
      <h2 id="live-orders">Live orders</h2>
      {orders.length > 0 ? (
        <ul className="orders" data-live-orders="">
          {orders.map((order) => (
            <li key={order.id}>{`Order ${order.id} · ${order.account} · ${dollars(order.total)}`}</li>
          ))}
        </ul>
      ) : (
        <p className={failed ? "unavailable" : undefined}>{failed ? "Live orders unavailable" : "Waiting for live orders…"}</p>
      )}
    </section>
  );
}

export function SearchOrders() {
  const [status, setStatus] = useState("open");
  const [state, setState] = useState(null);
  return (
    <section className="panel" aria-labelledby="search-orders">
      <h2 id="search-orders">Search orders</h2>
      <form
        className="search"
        onSubmit={(event) => {
          event.preventDefault();
          setState({ status: "loading" });
          searchOrders(status).then(
            (data) => setState({ status: "ready", data }),
            () => setState({ status: "failed" }),
          );
        }}
      >
        <label htmlFor="order-status">Order status</label>
        <select id="order-status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
        <button type="submit">Search</button>
      </form>
      {state?.status === "loading" && <p>Searching…</p>}
      {state?.status === "failed" && <p className="unavailable">Search unavailable</p>}
      {state?.status === "ready" && (
        <ul className="orders" aria-label="Search results" data-search-results="">
          {(state.data.orders ?? []).map((order) => (
            <li key={order.id}>{`Order ${order.id} · ${order.account} · ${dollars(order.total)}`}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Export orders: starts an export, then asks how it's going every half second until it's ready. */
export function useExport() {
  const [state, setState] = useState(null);
  const start = () => {
    setState({ status: "pending" });
    const poll = (id) =>
      exportStatus(id).then((progress) => {
        if (progress.status === "ready") setState({ status: "ready" });
        else setTimeout(() => poll(id).catch(() => setState({ status: "failed" })), 500);
      });
    startExport()
      .then((started) => (started.status === "ready" ? setState({ status: "ready" }) : poll(started.id)))
      .catch(() => setState({ status: "failed" }));
  };
  const text = state && { pending: "Preparing the export…", ready: "Export ready", failed: "Export unavailable" }[state.status];
  return [start, text];
}

/** Rates from the rates worker, and the ticker's latest quote. */
export function Markets() {
  const [rates, setRates] = useState(null);
  const [quote, setQuote] = useState(null);
  useEffect(() => {
    const worker = new Worker(new URL("./rates-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      setRates(event.data.rates ?? false);
      worker.terminate();
    };
    worker.onerror = () => setRates(false);
    return () => worker.terminate();
  }, []);
  useEffect(() => {
    const socket = ticker();
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.symbol) setQuote(message);
      } catch {
        // Not a quote.
      }
    };
    socket.onerror = () => setQuote((shown) => shown ?? false);
    socket.onclose = () => setQuote((shown) => shown ?? false);
    return () => socket.close();
  }, []);
  const rateText =
    rates === null
      ? "Loading rates…"
      : rates === false
        ? "Rates unavailable"
        : `Rates: 1 ${rates.base} = ${Object.entries(rates.rates ?? {})
            .map(([currency, rate]) => `${rate} ${currency}`)
            .join(" · ")}`;
  const quoteText = quote === null ? "Connecting to the ticker…" : quote === false ? "Ticker unavailable" : `Ticker: ${quote.symbol} ${Number(quote.price).toFixed(2)}`;
  return (
    <p className="markets">
      <span data-rates="">{rateText}</span>
      <span data-ticker="">{quoteText}</span>
    </p>
  );
}
