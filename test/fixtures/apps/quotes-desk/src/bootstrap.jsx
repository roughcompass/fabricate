import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { addErrorHandler, registerApplication, start } from "single-spa";
import { App } from "./app.jsx";

// A ticker that can't load leaves its placeholder; the desk carries on without it.
addErrorHandler((error) => console.warn(`The ticker didn't load: ${error.message}`));

// The ticker is a single-spa application the import map in index.html names.
registerApplication({
  name: "@fixtures/quotes-panel",
  app: () => import(/* webpackIgnore: true */ "@fixtures/quotes-panel"),
  activeWhen: () => true,
});
start();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
