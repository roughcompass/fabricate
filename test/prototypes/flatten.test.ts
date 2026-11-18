import { describe, expect, it } from "vitest";
import { PAYMENTS_APP } from "@/lib/demo/catalog/heroes";
import { runGates } from "@/lib/prototypes/gates";
import { flattenMainRoute } from "@/lib/prototypes/heroes/flatten";

// update-templates-salt-quality, design decisions 3 and 5: flattening a template's main route, deterministically, with its members' CSS modules.

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

// The payee list has a CSS module, which it imports as Prototypes does and reads plainly and conditionally.
const withModule = (code: string) =>
  code
    .replace('import { PAYEES, type Payee } from "../data";', 'import { PAYEES, type Payee } from "../data";\nimport classes from "./Prototype.module.css";')
    .replace("<StackLayout gap={1}>", "<StackLayout gap={1} className={picked ? classes.selected : classes[\"list\"]}>");
const MODULE = ".list {\n  list-style: none;\n}\n\n.selected {\n  background: var(--salt-selectable-background-selected);\n}\n";

const SOURCES: Record<string, { code: string; styles: string | null }> = {
  "payee-list": { code: withModule(member("Payee list", "payee:selected")), styles: MODULE },
  "transfer-form": { code: member("Transfer form", "transfer:started"), styles: null },
  "payment-activity": { code: member("Payment activity", "activity:refreshed"), styles: null },
};

describe("flattening a template's main route", () => {
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
  });

  it("lays the regions out on Salt's responsive grid, in one column below the medium breakpoint (Narrow screen)", () => {
    expect(page.code).toContain("<GridLayout columns={{ xs: 1, md: 3 }} gap={3}>");
    expect(page.code).toContain("<GridItem colSpan={{ xs: 1, md: 2 }}>\n        <PayeeList />");
    expect(page.code).toContain("<GridItem colSpan={{ xs: 1, md: 1 }}>\n        <TransferForm />");
    expect(page.code).toContain("<GridItem colSpan={{ xs: 1, md: 3 }}>\n        <PaymentActivity />");
  });

  it("merges each member's CSS module into the page's, with its classes prefixed and its reads renamed to match", () => {
    expect(page.styles).toBe("/* payee-list 1.0.0 */\n.PayeeList_list {\n  list-style: none;\n}\n\n.PayeeList_selected {\n  background: var(--salt-selectable-background-selected);\n}\n");
    expect(page.code).toContain('import styles from "./Prototype.module.css";');
    expect(page.code).not.toContain("classes");
    expect(page.code).toContain('className={picked ? styles["PayeeList_selected"] : styles["PayeeList_list"]}');
  });

  it("merges imports once each, with ./data as the page's sample data, and passes the four gates", async () => {
    expect(page.code.match(/^import .* from "@salt-ds\/core";$/gm)).toHaveLength(1);
    expect(page.code).toContain('import { type Payee, PAYEES } from "./data";');
    expect(page.code).not.toContain("../data");
    const run = await runGates({ code: page.code, data: DATA, styles: page.styles, portal: true });
    expect(run.results.flatMap((result) => result.issues)).toEqual([]);
  });

  it("produces the same page every time", () => {
    expect(flattenMainRoute(PAYMENTS_APP, "Payments workspace", () => "1.0.0", (id) => SOURCES[id]!).code).toBe(page.code);
  });
});
