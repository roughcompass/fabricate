import { useState } from "react";
import { Link } from "./router.jsx";

const ACCOUNTS = [
  { id: "42", name: "Northwind Traders", region: "North America", orders: 18, balance: 12840 },
  { id: "57", name: "Contoso Pharmaceuticals", region: "Europe", orders: 7, balance: 5320 },
  { id: "63", name: "Fabrikam Logistics", region: "Asia Pacific", orders: 24, balance: 20415 },
];

const dollars = (amount) => `$${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

/** Holds the main thread for +ms+, as an expensive calculation would. */
function hold(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Busy: nothing paints until this returns.
  }
}

export function Accounts({ selected }) {
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState(null);
  const needle = query.trim().toLowerCase();
  const shown = ACCOUNTS.filter((account) => account.name.toLowerCase().includes(needle));
  const account = ACCOUNTS.find((candidate) => candidate.id === selected);

  return (
    <>
      <h1>Accounts</h1>
      <p className="lead">Every account the orders team serves, with its open orders and balance.</p>
      <div className="actions">
        <span className="filter-label">Filter accounts</span>
        {/* The text beside it isn't its label: the field has no accessible name. */}
        <input type="search" className="filter" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button
          type="button"
          onClick={() => {
            // Totals take 650 ms to recalculate, all of it before the next paint.
            hold(650);
            setTotal(ACCOUNTS.reduce((sum, item) => sum + item.balance, 0));
          }}
        >
          Recalculate totals
        </button>
        <button type="button" className="secondary">
          Export orders
        </button>
      </div>
      <p className="total">{total === null ? "Totals haven't been calculated yet." : `Total balance ${dollars(total)}`}</p>
      <table className="accounts">
        <caption>Accounts</caption>
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Region</th>
            <th scope="col">Open orders</th>
            <th scope="col">Balance</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((item) => (
            <tr key={item.id} aria-current={item.id === selected ? "true" : undefined}>
              <td>
                <Link to={`/accounts/${item.id}`}>{item.name}</Link>
              </td>
              <td>{item.region}</td>
              <td>{item.orders}</td>
              <td>{dollars(item.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {account && (
        <section className="detail" aria-labelledby="account-name">
          <h2 id="account-name">{account.name}</h2>
          <p>{`Account ${account.id} · ${account.region} · ${account.orders} open orders · Balance ${dollars(account.balance)}`}</p>
        </section>
      )}
    </>
  );
}
