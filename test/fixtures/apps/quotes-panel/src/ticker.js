// The ticker: a single-spa application, as an ES module a host loads through
// its import map. It's copied into the build's output as it is.

let element = null;

export async function bootstrap() {}

export async function mount(props) {
  element = document.getElementById(`single-spa-application:${props.name}`);
  if (element) element.textContent = "Ticker: ACME 101.20 · GLOBEX 48.75";
}

export async function unmount() {
  if (element) element.textContent = "";
  element = null;
}
