import { describe, expect, it } from "vitest";
import { saltOnlyGate } from "@/lib/prototypes/gates";
import { goodSource } from "../../fixtures/prototypes";

const DATA = `export const payments = [{ id: "PAY-1", amount: "USD 10.00" }];\n`;

/** A component whose body is the given JSX, with extra statements before the return. */
function page(jsx: string, { imports = `import { StackLayout, Text } from "@salt-ds/core";`, before = "" } = {}): string {
  return `${imports}\nimport { payments } from "./data";\n\nexport default function Page() {\n${before}\n  return (\n    ${jsx}\n  );\n}\n`;
}

function check(code: string, data = DATA) {
  return saltOnlyGate({ code, data });
}

function codes(code: string, data = DATA): string[] {
  return check(code, data).issues.map((issue) => issue.code);
}

describe("Salt-only gate", () => {
  it("passes the good fixture, which uses only Salt components and tokens", () => {
    const result = check(goodSource().code, goodSource().data);
    expect(result).toMatchObject({ gate: "salt-only", status: "passed", issues: [] });
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("fails an import from another UI library and names it (Another UI library)", () => {
    const result = check(page(`<Card />`, { imports: `import { Card } from "@mui/material";` }));
    expect(result.status).toBe("failed");
    expect(result.issues).toEqual([
      { code: "salt-only/import", message: `Only React and Salt may be imported; "@mui/material" is not allowed.`, line: 1, column: 22, symbol: "@mui/material" },
    ]);
  });

  it("allows only the listed packages, not runtime-only ones such as the date adapters", () => {
    const allowed = [`import { useState } from "react";`, `import { Button } from "@salt-ds/core";`, `import { Tabs } from "@salt-ds/lab";`, `import { AddIcon } from "@salt-ds/icons";`, `import { DatePicker } from "@salt-ds/date-components";`, `import { AgGridReact } from "ag-grid-react";`].join("\n");
    expect(codes(page(`<StackLayout />`, { imports: allowed }))).toEqual([]);
    const result = check(page(`<StackLayout />`, { imports: `import { StackLayout } from "@salt-ds/core";\nimport { AdapterDateFns } from "@salt-ds/date-adapters";\nimport "./styles.css";\nexport * from "lodash";` }));
    expect(result.issues.map((issue) => issue.symbol)).toEqual(["@salt-ds/date-adapters", "./styles.css", "lodash"]);
  });

  it("lets the sample data import only types", () => {
    expect(codes(page(`<StackLayout />`), `import type { ValidationStatus } from "@salt-ds/core";\nexport const status: ValidationStatus = "info";\n`)).toEqual([]);
    const result = check(page(`<StackLayout />`), `import { useState } from "react";\nimport type { Thing } from "./data";\nexport const payments = [];\n`);
    expect(result.issues).toMatchObject([
      { code: "salt-only/import", message: `data.ts: The sample data module may only import types; "react" is imported for values.`, line: 1, symbol: "react" },
      { code: "salt-only/import", line: 2, symbol: "./data" },
    ]);
  });

  it("fails any inline style, even of Salt tokens (Inline style)", () => {
    const result = check(page(`<StackLayout>\n      <Text style={{ color: "var(--salt-content-primary-foreground)" }}>Urgent</Text>\n      <Text style={styles}>Late</Text>\n    </StackLayout>`, { before: "  const styles = {};" }));
    expect(result.status).toBe("failed");
    expect(result.issues[0]).toEqual({
      code: "salt-only/inline-style",
      message: "Line 8 sets style; use a Salt component's properties or a layout's gap and padding, and put anything else in Prototype.module.css.",
      line: 8,
      column: 13,
      symbol: "style",
    });
    expect(result.issues.map((issue) => issue.code)).toEqual(["salt-only/inline-style", "salt-only/inline-style"]);
  });

  it("fails raw elements, naming each, but allows a form and SVG drawing elements (A raw element)", () => {
    const result = check(page(`<StackLayout>\n      <div>One</div>\n      <strong>Two</strong>\n      <ul><li>Three</li></ul>\n    </StackLayout>`));
    expect(result.issues.map((issue) => [issue.code, issue.symbol])).toEqual([
      ["salt-only/raw-element", "div"],
      ["salt-only/raw-element", "strong"],
      ["salt-only/raw-element", "ul"],
      ["salt-only/raw-element", "li"],
    ]);
    expect(result.issues[0]!.message).toBe(`Line 8 renders <div>; use a Salt component, or a Salt layout such as StackLayout or FlexLayout (with as="section" for a landmark or list).`);
    const chart = `<form onSubmit={(event) => event.preventDefault()}>\n      <svg viewBox="0 0 10 10" role="img" aria-label="Trend"><title>Trend</title><g><path d="M0 0L10 10" stroke="var(--salt-content-primary-foreground)" fill="none" /><rect width="1" height="1" fill="currentColor" /></g></svg>\n    </form>`;
    expect(codes(page(chart))).toEqual([]);
  });

  it("allows an image only in a portal shell", () => {
    const logo = page(`<img src="/brand/jpmorgan-logo.svg" alt="J.P. Morgan" />`);
    expect(codes(logo)).toEqual(["salt-only/raw-element"]);
    expect(saltOnlyGate({ code: logo, data: DATA, shell: true }).issues).toEqual([]);
  });

  it("lets a Salt layout render landmarks and lists through as, and nothing else (A list through a Salt layout)", () => {
    expect(codes(page(`<StackLayout as="ul">\n      <FlexLayout as="li">One</FlexLayout>\n    </StackLayout>`, { imports: `import { FlexLayout, StackLayout } from "@salt-ds/core";` }))).toEqual([]);
    expect(codes(page(`<StackLayout as="nav" aria-label="Sections" />`))).toEqual([]);
    expect(check(page(`<StackLayout as="div" />`)).issues).toMatchObject([{ code: "salt-only/raw-element", symbol: "div" }]);
  });

  it("fails a literal color in an SVG paint attribute, but not Salt's own color props", () => {
    expect(check(page(`<svg><path d="M0 0" stroke="#31373d" /></svg>`)).issues).toMatchObject([{ code: "salt-only/literal-color", symbol: "stroke" }]);
    expect(codes(page(`<Text color="secondary">Late</Text>`))).toEqual([]);
  });

  it("fails className, except its CSS module's classes and AG Grid's Salt theme classes", () => {
    expect(check(page(`<StackLayout className="card shadow" />`)).issues).toMatchObject([{ code: "salt-only/class-name", line: 7, symbol: "className" }]);
    expect(codes(page(`<StackLayout className={"ag-theme-salt-compact"} />`))).toEqual([]);
    expect(codes(page(`<StackLayout className="ag-theme-salt ag-theme-salt-light" />`))).toEqual([]);
    expect(codes(page(`<StackLayout className="ag-theme-salt card" />`))).toEqual(["salt-only/class-name"]);
    expect(codes(page(`<StackLayout className={classes} />`, { before: `  const classes = "ag-theme-salt";` }))).toEqual(["salt-only/class-name"]);
  });

  describe("a CSS module", () => {
    const MODULE = `.row { background: var(--salt-selectable-background-selected); }\n.figure { font-variant-numeric: tabular-nums; }\n`;
    const withModule = (jsx: string, before = "") => page(jsx, { imports: `import { StackLayout, Text } from "@salt-ds/core";\nimport styles from "./Prototype.module.css";`, before });

    it("may be imported by default and read through className, plainly or conditionally", () => {
      const code = withModule(`<StackLayout className={selected ? styles.row : undefined}>\n      <Text className={[styles.figure, selected && styles.row].filter(Boolean).join(" ")}>1</Text>\n    </StackLayout>`, "  const selected = true;");
      expect(saltOnlyGate({ code, data: DATA, styles: MODULE })).toMatchObject({ status: "passed", issues: [], warnings: [] });
    });

    it("warns about a class the component never reads", () => {
      const code = withModule(`<StackLayout className={styles.row} />`);
      expect(saltOnlyGate({ code, data: DATA, styles: MODULE }).warnings).toMatchObject([{ code: "salt-only/unused-class", symbol: "figure" }]);
    });

    it("fails the import when the version has no module, and a named import of it", () => {
      expect(codes(withModule(`<StackLayout className={styles.row} />`))).toEqual(["salt-only/import", "salt-only/class-name"]);
      const named = page(`<StackLayout />`, { imports: `import { StackLayout } from "@salt-ds/core";\nimport { row } from "./Prototype.module.css";` });
      expect(saltOnlyGate({ code: named, data: DATA, styles: MODULE }).issues.map((issue) => issue.code)).toEqual(["salt-only/import"]);
    });

    it("fails element, id, and global selectors, other at-rules, and imports (An element selector)", () => {
      const css = `@import "x.css";\ntable td { color: var(--salt-content-primary-foreground); }\n#total { color: var(--salt-content-primary-foreground); }\n:global(.x) { color: var(--salt-content-primary-foreground); }\n@keyframes spin { from { opacity: 0; } }\n.ok[aria-selected="true"] { color: var(--salt-content-primary-foreground); }\n`;
      const result = saltOnlyGate({ code: withModule(`<StackLayout className={styles.ok} />`), data: DATA, styles: css });
      expect(result.issues.map((issue) => [issue.code, issue.symbol])).toEqual(
        expect.arrayContaining([
          ["salt-only/css-selector", "the table element"],
          ["salt-only/css-selector", "the #total id"],
          ["salt-only/css-selector", ":global()"],
          ["salt-only/css-at-rule", "@keyframes"],
          ["salt-only/css-import", "@import"],
        ]),
      );
      expect(result.issues.find((issue) => issue.symbol === "the table element")!.message).toBe("Prototype.module.css: Line 2 uses the table element; select only by class, pseudo-class, and aria- or data- attributes.");
    });

    it("fails literal colors, lengths, and typography, custom properties, !important, and URLs (Literal color)", () => {
      const css = `.a {\n  color: #b0b0b0;\n  padding: 4px var(--salt-spacing-100);\n  font-size: 12px;\n  --brand: var(--salt-color-blue-500);\n  width: var(--salt-size-base) !important;\n  background: url(/x.png);\n}\n`;
      const result = saltOnlyGate({ code: withModule(`<StackLayout className={styles.a} />`), data: DATA, styles: css });
      expect(result.issues.map((issue) => [issue.code, issue.line])).toEqual([
        ["salt-only/literal-color", 2],
        ["salt-only/literal-length", 3],
        ["salt-only/style-value", 4],
        ["salt-only/css-custom-property", 5],
        ["salt-only/css-important", 6],
        ["salt-only/css-import", 7],
      ]);
      expect(result.issues[0]!.message).toBe("Prototype.module.css: Line 2 sets color to #b0b0b0; use a Salt color token such as var(--salt-content-primary-foreground).");
    });

    it("allows tokens, calc() and grid functions over them, keywords, relative units, unitless counts, and media queries", () => {
      const css = `.grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(calc(var(--salt-size-base) * 8), 1fr));\n  gap: var(--salt-spacing-100) var(--salt-spacing-200);\n  width: 100%;\n  flex: 1 1 0;\n  font-weight: var(--salt-text-fontWeight-strong);\n  list-style: none;\n  margin: 0;\n}\n@media (min-width: 600px) { .grid:hover { color: var(--salt-content-primary-foreground); } }\n`;
      expect(saltOnlyGate({ code: withModule(`<StackLayout className={styles.grid} />`), data: DATA, styles: css }).issues).toEqual([]);
    });
  });

  it("fails <style>, <link>, <script>, <iframe>, <object>, and <embed>", () => {
    const result = check(page(`<StackLayout>\n      <style>{"p { color: red }"}</style>\n      <link rel="stylesheet" href="/x.css" />\n      <script />\n      <iframe />\n      <object />\n      <embed />\n    </StackLayout>`));
    expect(result.issues.map((issue) => issue.symbol)).toEqual(["style", "link", "script", "iframe", "object", "embed"]);
    expect(result.issues.every((issue) => issue.code === "salt-only/style-element")).toBe(true);
  });

  it("fails dangerouslySetInnerHTML", () => {
    const result = check(page(`<StackLayout dangerouslySetInnerHTML={{ __html: "<b>Release</b>" }} />`));
    expect(result.issues).toMatchObject([{ code: "salt-only/inner-html", line: 7, symbol: "dangerouslySetInnerHTML" }]);
  });

  it("fails importing or rendering a Salt provider, which the frame provides", () => {
    const result = check(
      page(`<SaltProviderNext>\n      <LocalizationProvider>\n        <StackLayout />\n      </LocalizationProvider>\n    </SaltProviderNext>`, {
        imports: `import { SaltProviderNext, StackLayout } from "@salt-ds/core";\nimport { LocalizationProvider } from "@salt-ds/date-components";`,
      }),
    );
    expect(result.issues.map((issue) => [issue.code, issue.symbol, issue.line])).toEqual([
      ["salt-only/provider", "SaltProviderNext", 1],
      ["salt-only/provider", "LocalizationProvider", 2],
      ["salt-only/provider", "SaltProviderNext", 8],
      ["salt-only/provider", "LocalizationProvider", 9],
    ]);
    expect(codes(page(`<SaltProvider />`, { imports: `import { SaltProvider } from "@salt-ds/core";` }))).toEqual(["salt-only/provider", "salt-only/provider"]);
  });

  it("fails network APIs, but not properties that share their names", () => {
    const before = [
      `  void fetch("/api/payments");`,
      `  const request = new XMLHttpRequest();`,
      `  const socket = new WebSocket("wss://example.test");`,
      `  const events = new EventSource("/events");`,
      `  navigator.sendBeacon("/log");`,
      `  void window.fetch("/api");`,
      `  const fine = { fetch: 1, WebSocket: 2 };`,
      `  void fine.fetch;`,
    ].join("\n");
    const result = check(page(`<Text>{String(request)}{String(socket)}{String(events)}</Text>`, { before }));
    expect(result.issues.map((issue) => [issue.code, issue.symbol, issue.line])).toEqual([
      ["salt-only/network", "fetch", 5],
      ["salt-only/network", "XMLHttpRequest", 6],
      ["salt-only/network", "WebSocket", 7],
      ["salt-only/network", "EventSource", 8],
      ["salt-only/network", "navigator.sendBeacon", 9],
      ["salt-only/network", "fetch", 10],
    ]);
    expect(result.issues[0]!.message).toBe("Prototypes run without network access; remove fetch and use the sample data in ./data.");
  });

  it("fails network APIs in the sample data too", () => {
    expect(check(page(`<StackLayout />`), `export const payments = fetch("/payments");\n`).issues).toMatchObject([{ code: "salt-only/network", message: expect.stringMatching(/^data\.ts: /), line: 1, symbol: "fetch" }]);
  });

  it("fails storage and cookie APIs", () => {
    const before = [`  localStorage.setItem("a", "b");`, `  sessionStorage.clear();`, `  void indexedDB;`, `  void caches;`, `  const cookie = document.cookie;`, `  void cookieStore;`].join("\n");
    const result = check(page(`<Text>{cookie}</Text>`, { before }));
    expect(result.issues.map((issue) => [issue.code, issue.symbol])).toEqual([
      ["salt-only/storage", "localStorage"],
      ["salt-only/storage", "sessionStorage"],
      ["salt-only/storage", "indexedDB"],
      ["salt-only/storage", "caches"],
      ["salt-only/storage", "document.cookie"],
      ["salt-only/storage", "cookieStore"],
    ]);
  });

  it("fails window.open and a bare open(), but not a local named open", () => {
    expect(check(page(`<StackLayout />`, { before: `  window.open("/x");\n  open("/y");` })).issues.map((issue) => [issue.code, issue.symbol])).toEqual([
      ["salt-only/window-open", "window.open"],
      ["salt-only/window-open", "open"],
    ]);
    const local = page(`<Text>{String(open)}</Text>`, { imports: `import { useState } from "react";\nimport { StackLayout, Text } from "@salt-ds/core";`, before: `  const [open, setOpen] = useState(false);\n  if (!open) setOpen(true);` });
    expect(codes(local)).toEqual([]);
  });

  it("fails eval, Function, dynamic import, require, and string timers", () => {
    const before = [
      `  eval("1");`,
      `  const make = new Function("return 1");`,
      `  Function("return 2")();`,
      `  void import("./other");`,
      `  require("fs");`,
      `  setTimeout("alert(1)", 10);`,
      `  setInterval(() => make(), 10);`,
    ].join("\n");
    const result = check(page(`<StackLayout />`, { before }));
    expect(result.issues.map((issue) => [issue.code, issue.symbol])).toEqual([
      ["salt-only/eval", "eval"],
      ["salt-only/eval", "Function"],
      ["salt-only/eval", "Function"],
      ["salt-only/eval", "import()"],
      ["salt-only/eval", "require"],
      ["salt-only/eval", "setTimeout"],
    ]);
  });

  it("fails assets loaded from outside DE FabLab", () => {
    const code = page(`<StackLayout>\n      <img alt="" src="https://cdn.example.com/logo.png" />\n      <Link href="//example.com">x</Link>\n      <img alt="" src="/logo.png" />\n    </StackLayout>`, { imports: `import { Link, StackLayout } from "@salt-ds/core";` });
    const result = saltOnlyGate({ code, data: DATA, shell: true });
    expect(result.issues.map((issue) => [issue.code, issue.symbol, issue.line])).toEqual([
      ["salt-only/external-asset", "src", 8],
      ["salt-only/external-asset", "href", 9],
    ]);
  });

  it("requires exactly one default export: none fails", () => {
    const result = check(`import { StackLayout } from "@salt-ds/core";\nexport function Page() { return <StackLayout />; }\n`);
    expect(result.issues).toEqual([{ code: "salt-only/default-export", message: "Prototype.tsx must have exactly one default export, the prototype component; it has none." }]);
  });

  it("requires exactly one default export: two fail, counting export { x as default }", () => {
    const result = check(`import { StackLayout } from "@salt-ds/core";\nexport default function Page() { return <StackLayout />; }\nconst Other = () => <StackLayout />;\nexport { Other as default };\n`);
    expect(result.issues).toMatchObject([{ code: "salt-only/default-export", line: 4, message: expect.stringContaining("it has 2") }]);
    expect(codes(`import { StackLayout } from "@salt-ds/core";\nconst Page = () => <StackLayout />;\nexport { Page as default };\n`)).toEqual([]);
  });
});
