// A dedicated worker that reads the exchange rates the totals are shown in,
// and posts them, or why it couldn't, to the page that started it.
import { API } from "./api.js";

fetch(`${API}/rates`)
  .then((response) => {
    if (!response.ok) throw new Error(`The orders API answered ${response.status}`);
    return response.json();
  })
  .then(
    (rates) => self.postMessage({ rates }),
    (error) => self.postMessage({ error: error.message }),
  );
