import { Suspense, lazy, useEffect, useState } from "react";
import { Accounts } from "./accounts.jsx";
import { Link, navigate, useRoute } from "./router.jsx";

// Settings loads on first visit, as its own chunk.
const Settings = lazy(() => import("./settings.jsx"));

function pageFor(route) {
  if (route === "/settings") return { name: "settings" };
  if (route === "/" || route === "/accounts") return { name: "accounts", account: null };
  const account = /^\/accounts\/([^/]+)$/.exec(route);
  return account ? { name: "accounts", account: account[1] } : { name: "missing" };
}

export function App() {
  const route = useRoute();
  const page = pageFor(route);
  const [feedback, setFeedback] = useState(false);

  useEffect(() => {
    if (route === "/") navigate("/accounts", { replace: true });
  }, [route]);

  return (
    <div className="layout">
      <header className="header">
        <p className="brand">Orders portal</p>
        <nav aria-label="Main" className="nav">
          <Link to="/accounts" aria-current={page.name === "accounts" ? "page" : undefined}>
            Accounts
          </Link>
          <Link to="/settings" aria-current={page.name === "settings" ? "page" : undefined}>
            Settings
          </Link>
        </nav>
      </header>
      <main className="main">
        {page.name === "accounts" && <Accounts selected={page.account} />}
        {page.name === "settings" && (
          <Suspense fallback={<p>Loading settings…</p>}>
            <Settings />
          </Suspense>
        )}
        {page.name === "missing" && (
          <>
            <h1>Page not found</h1>
            <p>
              <Link to="/accounts">Go to Accounts</Link>
            </p>
          </>
        )}
      </main>
      {/* Fixed to the middle of the right edge, above everything else on the page. */}
      <button type="button" className="feedback" aria-expanded={feedback} onClick={() => setFeedback((open) => !open)}>
        Feedback
      </button>
      {feedback && (
        <p className="feedback-note" role="status">
          Thanks. Tell the orders team what to improve.
        </p>
      )}
    </div>
  );
}
