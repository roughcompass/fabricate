import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SaltProvider } from "@salt-ds/core";
import "@salt-ds/theme/index.css";
import Quotes from "./Quotes.jsx";

// The remote's own page: its exposed module, outside any host.
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SaltProvider>
      <main style={{ padding: 24 }}>
        <h1>Quotes panel</h1>
        <Quotes />
      </main>
    </SaltProvider>
  </StrictMode>,
);
