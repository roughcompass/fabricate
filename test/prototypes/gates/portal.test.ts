import { describe, expect, it } from "vitest";
import { portalAllowed, saltOnlyGate, typecheckGate } from "@/lib/prototypes/gates";

// converge-templates-and-prototypes, design decision 5: the Salt-only gate allows `@deweb/portal` only for hero lineages.

const DATA = `export const payees = [{ id: "northwind", name: "Northwind Supplies" }];\n`;
const PORTAL_PAGE = `import { Button, StackLayout, Text } from "@salt-ds/core";
import { planted, routeHref, useBus, useProfile, usePublish, useRoute } from "@deweb/portal";
import { useState } from "react";
import { payees } from "./data";

export default function Payments() {
  const profile = useProfile();
  const { current, routes } = useRoute();
  const publish = usePublish("payee-list");
  const [selected, setSelected] = useState("");
  useBus("payee:selected", "transfer-form", (payload) => setSelected(String((payload as { name: string }).name)));
  return (
    <StackLayout gap={2}>
      <Text>{\`\${current.label} for \${profile.name}, \${profile.persona}\`}</Text>
      {routes.map((route) => <Text key={route.path}>{routeHref(route)}</Text>)}
      <Button onClick={() => { planted.blockMainThread(10); publish("payee:selected", payees[0]); }}>Pay</Button>
      <Text>{selected}</Text>
    </StackLayout>
  );
}
`;

const importIssues = (portal: boolean, code = PORTAL_PAGE, data = DATA) => saltOnlyGate({ code, data, portal }).issues.filter((issue) => issue.code === "salt-only/import");

describe("@deweb/portal in the gates", () => {
  it("passes the Salt-only and typecheck gates for a hero lineage", () => {
    expect(saltOnlyGate({ code: PORTAL_PAGE, data: DATA, portal: true })).toMatchObject({ status: "passed", issues: [] });
    expect(typecheckGate({ code: PORTAL_PAGE, data: DATA, portal: true })).toMatchObject({ status: "passed", issues: [] });
  });

  it("refuses it everywhere else, naming why", () => {
    expect(importIssues(false)).toEqual([expect.objectContaining({ symbol: "@deweb/portal", message: expect.stringMatching(/only for pages that start from a hero template/) })]);
    expect(saltOnlyGate({ code: PORTAL_PAGE, data: DATA }).status).toBe("failed");
    expect(typecheckGate({ code: PORTAL_PAGE, data: DATA }).issues.map((issue) => issue.code)).toContain("TS2307");
  });

  it("never allows it in the sample data module, even for a hero lineage", () => {
    const data = `import { planted } from "@deweb/portal";\nplanted.blockMainThread(1);\nexport const payees = [];\n`;
    expect(importIssues(true, `import { Text } from "@salt-ds/core";\nexport default function Page() { return <Text>Hi</Text>; }\n`, data)).toEqual([expect.objectContaining({ symbol: "@deweb/portal" })]);
  });

  it("allows it only for provenance that names a hero", () => {
    expect(portalAllowed({ hero: "payments-workspace" })).toBe(true);
    expect(portalAllowed({ hero: null })).toBe(false);
    expect(portalAllowed({})).toBe(false);
    expect(portalAllowed(null)).toBe(false);
  });
});
