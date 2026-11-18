import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PROTOTYPE_GLOBAL, buildGate } from "@/lib/prototypes/gates";
import { goodSource } from "../../fixtures/prototypes";

// Compiled output is written inside the project, so Node resolves its bare
// imports ("react/jsx-runtime", "@salt-ds/core") from node_modules, as the
// frame's import map does in the browser.
const OUT_DIR = path.resolve("tmp/gates-test");
const registry = globalThis as typeof globalThis & { [PROTOTYPE_GLOBAL]?: unknown };

async function execute(compiled: string): Promise<unknown> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `prototype-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(file, compiled);
  try {
    await import(/* @vite-ignore */ pathToFileURL(file).href);
    return registry[PROTOTYPE_GLOBAL];
  } finally {
    fs.rmSync(file, { force: true });
  }
}

describe("build gate", () => {
  afterEach(() => {
    delete registry[PROTOTYPE_GLOBAL];
  });

  afterAll(() => fs.rmSync(OUT_DIR, { recursive: true, force: true }));

  it("compiles the good fixture to a module that registers the component, which renders the sample data", async () => {
    const { result, compiled } = buildGate(goodSource());
    expect(result).toMatchObject({ gate: "build", status: "passed", issues: [] });
    expect(result.durationMs).toBeGreaterThan(0);
    expect(compiled).toContain(`import { Badge, FlexLayout, H2, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, Text } from "@salt-ds/core";`);
    expect(compiled).toContain(`from "react/jsx-runtime"`);
    expect(compiled).not.toMatch(/^export /m);
    expect(compiled).not.toContain("./data");

    const component = await execute(compiled!);
    expect(typeof component).toBe("function");
    const markup = renderToStaticMarkup(createElement(component as ComponentType));
    expect(markup).toContain("Urgent payments");
    expect(markup).toContain("Northwind Logistics");
    expect(markup).toContain("Payments not released before their cut-off");
  });

  it("registers every form of default export", async () => {
    const forms = {
      expression: `const label = "expression";\nexport default () => label;\n`,
      anonymous: `export default function () { return "anonymous"; }\n`,
      renamed: `export { Page as default };\nconst Page = () => "renamed";\n`,
      class: `import { Component } from "react";\nexport default class Page extends Component { render() { return "class"; } }\n`,
    };
    for (const [form, code] of Object.entries(forms)) {
      const { result, compiled } = buildGate({ code, data: "export {};\n" });
      expect(result.status, form).toBe("passed");
      const component = (await execute(compiled!)) as ComponentType;
      expect(renderToStaticMarkup(createElement(component)), form).toBe(form);
    }
  });

  it("reads default, named, renamed, and namespace imports of ./data from the inlined data, dropping type-only ones", async () => {
    const data = `export interface Row { name: string }\nexport const rows: Row[] = [{ name: "a" }, { name: "b" }];\nexport const title = "Rows";\nexport default "default";\n`;
    const code = [
      `import fallback, { rows as items, type Row } from "./data";`,
      `import type { Row as Same } from "./data";`,
      `import * as all from "./data";`,
      `export const helper = (row: Row | Same) => row.name;`,
      `export default function Page() { return [fallback, all.title, ...items.map(helper)].join(","); }`,
    ].join("\n");
    const { result, compiled } = buildGate({ code, data });
    expect(result.status).toBe("passed");
    expect(compiled).toContain("const { rows: items } = __fabricateData;");
    const component = (await execute(compiled!)) as ComponentType;
    expect(renderToStaticMarkup(createElement(component))).toBe("default,Rows,a,b");
  });

  it("fails a syntax error, with the line, and produces no module", () => {
    const code = `import { Text } from "@salt-ds/core";\nexport default function Page() {\n  return <Text>Unclosed;\n}\n`;
    const { result, compiled } = buildGate({ code, data: "export {};\n" });
    expect(result.status).toBe("failed");
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]).toMatchObject({ code: expect.stringMatching(/^TS\d+$/), line: expect.any(Number) });
    expect(compiled).toBeNull();
  });

  it("fails a syntax error in the sample data", () => {
    const { result, compiled } = buildGate({ code: goodSource().code, data: `export const payments = [;\n` });
    expect(result.issues[0]).toMatchObject({ code: expect.stringMatching(/^TS\d+$/), message: expect.stringMatching(/^data\.ts: /), line: 1 });
    expect(compiled).toBeNull();
  });

  it("fails when there is no default export to register", () => {
    const { result, compiled } = buildGate({ code: `export function Page() { return null; }\n`, data: "export {};\n" });
    expect(result.issues).toEqual([{ code: "build/no-component", message: "Prototype.tsx has no default export to register as the prototype component." }]);
    expect(compiled).toBeNull();
  });
  it("compiles a CSS module to scoped classes the component reads, with the stylesheet for the frame", async () => {
    const code = `import { Text } from "@salt-ds/core";\nimport styles from "./Prototype.module.css";\nexport default function Figure() { return <Text className={styles.figure}>12</Text>; }\n`;
    const { result, compiled } = buildGate({ code, data: "export {};\n", styles: ".figure { font-variant-numeric: tabular-nums; }\n" });
    expect(result.status).toBe("passed");
    expect(compiled).not.toContain("Prototype.module.css");
    expect(compiled).toMatch(/^globalThis\.__fabricateCss = ".p-figure-[\w-]+\{font-variant-numeric:tabular-nums\}";/);
    const component = await execute(compiled!);
    expect(renderToStaticMarkup(createElement(component as ComponentType))).toMatch(/class="[^"]*p-figure-[\w-]+/);
    delete (globalThis as Record<string, unknown>).__fabricateCss;
  });
});
