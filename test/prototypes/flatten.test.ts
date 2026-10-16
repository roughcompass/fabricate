import { describe, expect, it } from "vitest";
import { PAYMENTS_APP } from "@/lib/demo/catalog/heroes";
import { runGates } from "@/lib/prototypes/gates";
import { flattenMainRoute } from "@/lib/prototypes/heroes/flatten";

// converge-templates-and-prototypes, design decision 7: flattening a hero's main route, deterministically.

const DATA = 'export interface Payee {\n  readonly id: string;\n  readonly name: string;\n}\n\nexport const PAYEES: readonly Payee[] = [{ id: "northwind", name: "Northwind Supplies" }];\n';

// Each member names a MEMBER constant, a Row helper, and a type import, as generated members do.
const member = (title: string, topic: string) => `import { Button, StackLayout, Text } from "@salt-ds/core";
import { usePublish } from "@deweb/portal";
import { useState } from "react";
import { PAYEES, type Payee } from "../data";

const MEMBER = ${JSON.stringify(title.toLowerCase().replace(/ /g, "-"))};

function Row({ payee, onPick }: { payee: Payee; onPick: (payee: Payee) => void }) {
  return <Button onClick={() => onPick(payee)}>{payee.name}</Button>;
}

export default function Member() {
  const publish = usePublish(MEMBER);
  const [picked, setPicked] = useState<string | null>(null);
  const pick = (payee: Payee) => {
    setPicked(payee.id);
    publish(${JSON.stringify(topic)}, { id: payee.id, MEMBER });
  };
  return (
    <StackLayout gap={1}>
      <Text>${title}</Text>
      {PAYEES.map((payee) => <Row key={payee.id} payee={payee} onPick={pick} />)}
      <Text>{picked ?? "None"}</Text>
    </StackLayout>
  );
}
`;

const SOURCES: Record<string, string> = { "payee-list": member("Payee list", "payee:selected"), "transfer-form": member("Transfer form", "transfer:started"), "payment-activity": member("Payment activity", "activity:refreshed") };

describe("flattening a hero's main route", () => {
  const page = flattenMainRoute(PAYMENTS_APP, "Payments workspace", () => "1.0.0", (id) => SOURCES[id]!);

  it("composes the main route's regions in order, by area, as local components with prefixed helpers", () => {
    expect(page.route).toBe("payees");
    expect(page.regions).toEqual([
      { member: "payee-list", version: "1.0.0", area: "main" },
      { member: "transfer-form", version: "1.0.0", area: "side" },
      { member: "payment-activity", version: "1.0.0", area: "wide" },
    ]);
    for (const name of ["PayeeList", "TransferForm", "PaymentActivity"]) {
      expect(page.code).toContain(`function ${name}()`);
      expect(page.code).toContain(`const ${name}_MEMBER =`);
      expect(page.code).toContain(`function ${name}_Row(`);
      expect(page.code).toContain(`<${name}_Row key={payee.id}`);
    }
    // A shorthand property keeps its key; a parameter with a helper's name is left alone.
    expect(page.code).toContain("{ id: payee.id, MEMBER: PayeeList_MEMBER }");
    expect(page.code).toContain("onPick={pick}");
    expect(page.code).toContain('<GridItem colSpan={2}>\n        <PayeeList />');
    expect(page.code).toContain('<GridItem colSpan={1}>\n        <TransferForm />');
    expect(page.code).toContain('<GridItem colSpan={3}>\n        <PaymentActivity />');
  });

  it("merges imports once each, with ./data as the page's sample data, and passes the four gates", async () => {
    expect(page.code.match(/^import .* from "@salt-ds\/core";$/gm)).toHaveLength(1);
    expect(page.code).toContain('import { type Payee, PAYEES } from "./data";');
    expect(page.code).not.toContain("../data");
    const run = await runGates({ code: page.code, data: DATA, portal: true });
    expect(run.results.flatMap((result) => result.issues)).toEqual([]);
  });

  it("produces the same page every time", () => {
    expect(flattenMainRoute(PAYMENTS_APP, "Payments workspace", () => "1.0.0", (id) => SOURCES[id]!).code).toBe(page.code);
  });
});
