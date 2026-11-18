import { describe, expect, it } from "vitest";
import { failureSignatures, runGates } from "@/lib/prototypes/gates";
import type { GateResult } from "@/lib/prototypes/types";
import { goodSource, hallucinatedPropSource } from "../../fixtures/prototypes";

describe("running the gates", () => {
  it("runs all four gates in order on the good fixture, which passes and compiles", async () => {
    const run = await runGates(goodSource());
    expect(run.results.map((result) => [result.gate, result.status])).toEqual([
      ["salt-only", "passed"],
      ["typecheck", "passed"],
      ["salt-usage", "passed"],
      ["build", "passed"],
    ]);
    expect(run.results.every((result) => result.durationMs > 0)).toBe(true);
    expect(run.passed).toBe(true);
    expect(run.compiled).toContain("globalThis.__fabricatePrototype = UrgentPayments;");
    expect(run.signatures).toEqual([]);
  });

  it("runs every gate after a failure, so a repair sees all of them", async () => {
    const source = hallucinatedPropSource();
    const run = await runGates({ ...source, code: source.code.replace("<StackLayout gap={2}>", `<StackLayout gap={2} style={{ color: "#31373d" }}>`) });
    expect(run.results.map((result) => [result.gate, result.status])).toEqual([
      ["salt-only", "failed"],
      ["typecheck", "failed"],
      ["salt-usage", "passed"],
      ["build", "passed"],
    ]);
    expect(run.passed).toBe(false);
    expect(run.compiled).not.toBeNull();
    expect(run.signatures).toEqual(["salt-only:salt-only/inline-style:style", "typecheck:TS2322:Button.size"]);
  });

  it("gives the same failure signatures for the same failing code, run twice", async () => {
    const first = await runGates(hallucinatedPropSource());
    const second = await runGates(hallucinatedPropSource());
    expect(first.signatures).toEqual(["typecheck:TS2322:Button.size"]);
    expect(second.signatures).toEqual(first.signatures);
  });

  it("gives the same failure signatures when the bad property moves to another line", async () => {
    const source = hallucinatedPropSource();
    const moved = source.code
      .replace(`<Button size="large" appearance="solid" sentiment="accented">`, `<Button appearance="solid" sentiment="accented">`)
      .replace(`<H2>Release queue</H2>`, `<H2>Release queue</H2>\n      <Text>Before the queue</Text>\n      <Button\n        sentiment="neutral"\n        size="large"\n      >\n        Hold\n      </Button>`);
    const original = await runGates(source);
    const edited = await runGates({ ...source, code: moved });
    expect(edited.results[1]!.issues[0]!.line).not.toBe(original.results[1]!.issues[0]!.line);
    expect(edited.signatures).toEqual(original.signatures);
  });

  it("builds signatures from failed gates' issues only, deduplicated and sorted, without lines or messages", () => {
    const results: GateResult[] = [
      { gate: "salt-only", status: "failed", issues: [{ code: "salt-only/default-export", message: "none", line: 1 }], warnings: [], durationMs: 1 },
      {
        gate: "typecheck",
        status: "failed",
        issues: [
          { code: "TS2322", message: "a", line: 9, symbol: "Button.color" },
          { code: "TS2322", message: "b", line: 30, symbol: "Button.color" },
          { code: "TS2304", message: "c", line: 2, symbol: "Missing" },
        ],
        warnings: [],
        durationMs: 1,
      },
      { gate: "salt-usage", status: "not-run", issues: [], warnings: [{ code: "salt-usage/not-run", message: "x" }], durationMs: 1 },
      { gate: "build", status: "passed", issues: [], warnings: [{ code: "w", message: "w" }], durationMs: 1 },
    ];
    expect(failureSignatures(results)).toEqual(["salt-only:salt-only/default-export", "typecheck:TS2304:Missing", "typecheck:TS2322:Button.color"]);
  });
});
