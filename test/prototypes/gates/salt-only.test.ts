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

  it("fails a literal color in a style and names the line (Literal color)", () => {
    const code = page(`<StackLayout>\n      <Text style={{ color: "#31373d" }}>Urgent</Text>\n      <Text style={{ background: "rgba(0, 0, 0, 0.5)", borderColor: "red" }}>Late</Text>\n    </StackLayout>`);
    const result = check(code);
    expect(result.status).toBe("failed");
    expect(result.issues[0]).toEqual({
      code: "salt-only/literal-color",
      message: "Line 8 sets color to #31373d; use a Salt color token such as var(--salt-content-primary-foreground).",
      line: 8,
      column: 22,
      symbol: "style.color",
    });
    expect(result.issues.slice(1).map((issue) => [issue.code, issue.symbol])).toEqual([
      ["salt-only/literal-color", "style.background"],
      ["salt-only/literal-color", "style.borderColor"],
    ]);
  });

  it("fails literal lengths in a style, including bare numbers", () => {
    const result = check(page(`<StackLayout style={{ padding: "12px", marginTop: 8, width: "50%", gap: "1.5rem var(--salt-spacing-100)" }} />`));
    expect(result.issues.map((issue) => [issue.code, issue.symbol])).toEqual([
      ["salt-only/literal-length", "style.padding"],
      ["salt-only/literal-length", "style.marginTop"],
      ["salt-only/literal-length", "style.width"],
      ["salt-only/literal-length", "style.gap"],
    ]);
    expect(result.issues[0]!.message).toBe("Line 7 sets padding to 12px; use a Salt spacing or size token such as var(--salt-spacing-100).");
  });

  it("fails any other style value, and a style that isn't an object of tokens", () => {
    const result = check(
      page(`<StackLayout>\n      <Text style={{ padding: spacing, margin: \`\${spacing}\`, display: "flex", ...extra, flexGrow: 1 }} />\n      <Text style={styles} />\n    </StackLayout>`, {
        before: `  const spacing = "var(--salt-spacing-100)";\n  const extra = {};\n  const styles = {};`,
      }),
    );
    expect(result.issues.map((issue) => [issue.code, issue.symbol])).toEqual([
      ["salt-only/style-value", "style.padding"],
      ["salt-only/style-value", "style.margin"],
      ["salt-only/style-value", "style"],
      ["salt-only/style-value", "style"],
    ]);
  });

  it("allows CSS keywords, unitless counts, and calc() over Salt tokens, but not literal typography", () => {
    const allowed = `{ display: "flex", textAlign: "right", justifyContent: "space-between", whiteSpace: "nowrap", flexGrow: 1, opacity: 0.6, width: "calc(var(--salt-size-base) * 4)", borderStyle: "var(--salt-borderStyle-solid)" }`;
    expect(codes(page(`<StackLayout style={${allowed}} />`))).toEqual([]);
    const result = check(page(`<StackLayout style={{ fontWeight: 700, fontFamily: "Arial", lineHeight: 1.4, width: "calc(var(--salt-size-base) + 4px)" }} />`));
    expect(result.issues.map((issue) => [issue.code, issue.symbol])).toEqual([
      ["salt-only/style-value", "style.fontWeight"],
      ["salt-only/style-value", "style.fontFamily"],
      ["salt-only/style-value", "style.lineHeight"],
      ["salt-only/literal-length", "style.width"],
    ]);
  });

  it("allows Salt tokens, a Salt token fallback, and zero in styles", () => {
    const style = `{ padding: "var(--salt-spacing-100)", color: "var(--salt-content-primary-foreground, var(--salt-color-gray-900))", margin: 0, borderWidth: "0", gap: "var( --salt-spacing-200 )" }`;
    expect(codes(page(`<StackLayout style={${style}} />`))).toEqual([]);
    expect(codes(page(`<StackLayout style={{ color: "var(--brand-color)" }} />`))).toEqual(["salt-only/style-value"]);
    expect(codes(page(`<StackLayout style={{ color: "var(--salt-a, red)" }} />`))).toEqual(["salt-only/literal-color"]);
  });

  it("fails className, except AG Grid's Salt theme classes", () => {
    expect(check(page(`<div className="card shadow" />`)).issues).toMatchObject([{ code: "salt-only/class-name", line: 7, symbol: "className" }]);
    expect(codes(page(`<div className={"ag-theme-salt-compact"} />`, { before: "" }))).toEqual([]);
    expect(codes(page(`<div className="ag-theme-salt ag-theme-salt-light" />`))).toEqual([]);
    expect(codes(page(`<div className="ag-theme-salt card" />`))).toEqual(["salt-only/class-name"]);
    expect(codes(page(`<div className={classes} />`, { before: `  const classes = "ag-theme-salt";` }))).toEqual(["salt-only/class-name"]);
  });

  it("fails <style>, <link>, <script>, <iframe>, <object>, and <embed>", () => {
    const result = check(page(`<StackLayout>\n      <style>{"p { color: red }"}</style>\n      <link rel="stylesheet" href="/x.css" />\n      <script />\n      <iframe />\n      <object />\n      <embed />\n    </StackLayout>`));
    expect(result.issues.map((issue) => issue.symbol)).toEqual(["style", "link", "script", "iframe", "object", "embed"]);
    expect(result.issues.every((issue) => issue.code === "salt-only/style-element")).toBe(true);
  });

  it("fails dangerouslySetInnerHTML", () => {
    const result = check(page(`<div dangerouslySetInnerHTML={{ __html: "<b>Release</b>" }} />`));
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
    const result = check(page(`<StackLayout>\n      <img alt="" src="https://cdn.example.com/logo.png" />\n      <a href="//example.com">x</a>\n      <img alt="" src="/logo.png" />\n    </StackLayout>`));
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
