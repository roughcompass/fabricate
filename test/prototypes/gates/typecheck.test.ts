import { describe, expect, it } from "vitest";
import { typecheckGate } from "@/lib/prototypes/gates";
import { goodSource, hallucinatedPropSource } from "../../fixtures/prototypes";

describe("typecheck gate", () => {
  // Runs first, so the first call parses React, Salt, and the DOM library cold.
  it("records its timing, and a second check reuses the parsed library files", () => {
    const first = typecheckGate(goodSource());
    const second = typecheckGate(goodSource());
    expect(first.durationMs).toBeGreaterThan(0);
    expect(second.durationMs).toBeGreaterThan(0);
    expect(second.durationMs).toBeLessThan(first.durationMs);
  });

  it("passes the good fixture against Salt's and React's types", () => {
    expect(typecheckGate(goodSource())).toMatchObject({ gate: "typecheck", status: "passed", issues: [], warnings: [] });
  });

  it("fails a property Salt's Button doesn't have and names the property and line (Hallucinated property)", () => {
    const result = typecheckGate(hallucinatedPropSource());
    expect(result.status).toBe("failed");
    expect(result.issues).toEqual([{ code: "TS2322", message: expect.stringContaining("Property 'size' does not exist"), line: 10, column: 17, symbol: "Button.size" }]);
  });

  it("names the identifier when a diagnostic is outside a JSX attribute", () => {
    const code = `import { Text } from "@salt-ds/core";\nimport { payments } from "./data";\n\nexport default function Page() {\n  return <Text>{payments.lenght}</Text>;\n}\n`;
    expect(typecheckGate({ code, data: goodSource().data }).issues).toMatchObject([{ code: "TS2551", line: 5, symbol: "lenght" }]);
  });

  it("reports errors in the sample data as data.ts errors", () => {
    const result = typecheckGate({ code: goodSource().code, data: `${goodSource().data}\nexport const count: number = "four";\n` });
    expect(result.issues).toMatchObject([{ code: "TS2322", message: expect.stringMatching(/^data\.ts: /), line: 21, symbol: "count" }]);
  });

  it("fails an import the installed packages can't resolve", () => {
    const code = `import { Card } from "@mui/material";\nexport default function Page() { return <Card />; }\n`;
    expect(typecheckGate({ code, data: "export {};" }).issues).toMatchObject([{ code: "TS2307", line: 1 }]);
  });
  it("types a CSS module by its classes, so a missing class fails (A missing class)", () => {
    const code = `import { Text } from "@salt-ds/core";\nimport styles from "./Prototype.module.css";\nexport default function Row() { return <Text className={styles.selcted}>Row</Text>; }\n`;
    expect(typecheckGate({ code, data: "export {};\n", styles: ".selected { background: var(--salt-selectable-background-selected); }\n" }).issues).toMatchObject([{ code: "TS2551", line: 3, message: expect.stringContaining("selcted") }]);
    expect(typecheckGate({ code: code.replace("selcted", "selected"), data: "export {};\n", styles: ".selected { background: var(--salt-selectable-background-selected); }\n" }).issues).toEqual([]);
  });
});
