import { describe, expect, it } from "vitest";
import { saltUsageGate } from "@/lib/prototypes/gates";
import { goodSource } from "../../fixtures/prototypes";

const DATA = "export {};\n";

describe("Salt usage gate", () => {
  it("passes the good fixture with no warnings", async () => {
    expect(await saltUsageGate(goodSource())).toMatchObject({ gate: "salt-usage", status: "passed", issues: [], warnings: [] });
  });

  it("reports Button's deprecated variant with Salt's suggested fix, without failing (Deprecated usage)", async () => {
    const code = `import { Button } from "@salt-ds/core";\nexport default function Page() { return <Button variant="cta">Release</Button>; }\n`;
    const result = await saltUsageGate({ code, data: DATA });
    expect(result.status).toBe("passed");
    expect(result.warnings).toEqual([
      { code: "deprecated.prop.salt-ds-core.variant", message: "Deprecated prop used: variant: Use appearance and sentiment instead.", fix: "Replace variant with appearance." },
    ]);
  });

  it("fails on a validator error, such as an icon-only Button without a name", async () => {
    const code = `import { Button } from "@salt-ds/core";\nimport { AddIcon } from "@salt-ds/icons";\nexport default function Page() { return <Button><AddIcon /></Button>; }\n`;
    const result = await saltUsageGate({ code, data: DATA });
    expect(result.status).toBe("failed");
    expect(result.issues).toMatchObject([{ code: "a11y.button-accessible-name", fix: expect.stringContaining("aria-label") }]);
  });

  it("warns that lab Tokenized input is pre-release, and the version stays ready (Lab component with no stable equivalent)", async () => {
    const code = `import { TokenizedInput } from "@salt-ds/lab";\nexport default function Page() { return <TokenizedInput />; }\n`;
    const result = await saltUsageGate({ code, data: DATA });
    expect(result.status).toBe("passed");
    expect(result.warnings).toEqual([{ code: "salt-usage/lab", message: "Tokenized input is a pre-release Salt component from @salt-ds/lab.", symbol: "TokenizedInput", line: 1, column: 10 }]);
  });

  it("names the stable component and its package for a lab component Salt has released (Lab component with a stable equivalent)", async () => {
    const code = `import { Tabs, TokenizedInput } from "@salt-ds/lab";\nexport default function Page() { return <><Tabs /><TokenizedInput /></>; }\n`;
    const result = await saltUsageGate({ code, data: DATA });
    expect(result.status).toBe("passed");
    expect(result.warnings[0]).toEqual({
      code: "salt-usage/lab",
      message: "Tabs is a pre-release Salt component from @salt-ds/lab. Use Tabs from @salt-ds/core, which is stable.",
      symbol: "Tabs",
      line: 1,
      column: 10,
      fix: "Import Tabs from @salt-ds/core instead of Tabs from @salt-ds/lab.",
    });
    expect(result.warnings.map((warning) => warning.symbol)).toEqual(["Tabs", "TokenizedInput"]);
  });

  it("falls back to not run, with a warning, when the registry can't load", async () => {
    const result = await saltUsageGate(goodSource(), { registry: () => Promise.reject(new Error("registry directory is missing")) });
    expect(result).toMatchObject({ gate: "salt-usage", status: "not-run", issues: [] });
    expect(result.warnings).toEqual([{ code: "salt-usage/not-run", message: "Salt's usage validator could not run, so Salt usage was not checked: registry directory is missing" }]);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("falls back to not run when the validator throws", async () => {
    const result = await saltUsageGate(goodSource(), {
      validate: () => {
        throw new Error("unsupported syntax");
      },
    });
    expect(result).toMatchObject({ status: "not-run", issues: [], warnings: [{ code: "salt-usage/not-run", message: expect.stringContaining("unsupported syntax") }] });
  });
});
