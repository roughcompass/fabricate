/**
 * What the scripted mock model writes (design.md, decision 16): small, valid
 * Salt prototypes that pass every gate, so browser tests exercise the real
 * pipeline without a model service. Every name and figure is fictional.
 */

export const MOCK_DATA = `import type { ValidationStatus } from "@salt-ds/core";

export interface Payment {
  readonly id: string;
  readonly beneficiary: string;
  readonly amount: string;
  readonly cutOff: string;
  readonly status: ValidationStatus;
  readonly statusLabel: string;
}

export const payments: readonly Payment[] = [
  { id: "PAY-1042", beneficiary: "Northwind Logistics", amount: "USD 1,250,000.00", cutOff: "14:30 ET", status: "warning", statusLabel: "Awaiting approval" },
  { id: "PAY-1043", beneficiary: "Contoso Freight", amount: "EUR 480,500.00", cutOff: "15:00 CET", status: "error", statusLabel: "Sanctions check failed" },
  { id: "PAY-1044", beneficiary: "Fabrikam Metals", amount: "GBP 92,310.45", cutOff: "16:00 GMT", status: "success", statusLabel: "Released" },
  { id: "PAY-1045", beneficiary: "Tailspin Energy", amount: "USD 3,075,000.00", cutOff: "14:30 ET", status: "info", statusLabel: "Second approver assigned" },
];

export const cutOffNote = "Payments not released before their cut-off move to the next value date.";
`;

const quote = (text: string) => JSON.stringify(text);

/** A page body: the payments in a Salt table, headed by the direction's title. */
export function mockPage(title: string, note = ""): string {
  return `import { Badge, Button, FlexLayout, H1, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, Text } from "@salt-ds/core";
import { cutOffNote, payments } from "./data";

export default function Page() {
  const pending = payments.filter((payment) => payment.status !== "success").length;
  return (
    <StackLayout gap={2}>
      <FlexLayout align="center" gap={1}>
        <H1>{${quote(title)}}</H1>
        <Badge value={pending} aria-label={\`\${pending} payments need action\`} />
      </FlexLayout>
      <Text color="secondary">{cutOffNote}</Text>${note ? `\n      <Text>{${quote(note)}}</Text>` : ""}
      <Table zebra>
        <THead>
          <TR>
            <TH>Payment</TH>
            <TH>Beneficiary</TH>
            <TH textAlign="right">Amount</TH>
            <TH>Cut-off</TH>
            <TH>Status</TH>
            <TH>Action</TH>
          </TR>
        </THead>
        <TBody>
          {payments.map((payment) => (
            <TR key={payment.id}>
              <TD>{payment.id}</TD>
              <TD>{payment.beneficiary}</TD>
              <TD textAlign="right">{payment.amount}</TD>
              <TD>{payment.cutOff}</TD>
              <TD>
                <FlexLayout align="center" gap={1}>
                  <StatusIndicator status={payment.status} />
                  <Text>{payment.statusLabel}</Text>
                </FlexLayout>
              </TD>
              <TD>
                <Button appearance="bordered" sentiment="accented" disabled={payment.status === "success"}>
                  Approve
                </Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </StackLayout>
  );
}
`;
}

/** A component: one payment's approval card. */
export function mockComponent(title: string): string {
  return `import { Button, Card, FlexLayout, H3, StackLayout, StatusIndicator, Text } from "@salt-ds/core";
import { payments } from "./data";

export default function PaymentCard() {
  const payment = payments[0]!;
  return (
    <Card>
      <StackLayout gap={1}>
        <H3>{${quote(title)}}</H3>
        <Text>{payment.beneficiary}</Text>
        <Text styleAs="h2">{payment.amount}</Text>
        <FlexLayout align="center" gap={1}>
          <StatusIndicator status={payment.status} />
          <Text>{payment.statusLabel}</Text>
        </FlexLayout>
        <Text color="secondary">{\`Cut-off \${payment.cutOff}\`}</Text>
        <FlexLayout gap={1}>
          <Button appearance="solid" sentiment="accented">Approve</Button>
          <Button appearance="bordered">Reject</Button>
        </FlexLayout>
      </StackLayout>
    </Card>
  );
}
`;
}

/** The page with a property Salt's Button doesn't have, which the typecheck fails. */
export function mockBrokenPage(title: string): string {
  return mockPage(title).replace('<Button appearance="bordered"', '<Button size="large" appearance="bordered"');
}

/**
 * A hero microfrontend in the mock's portal-member voice: it lists the
 * records of the data's first exported array, here `records`, and publishes
 * the one chosen, using `@deweb/portal`.
 */
export function mockPortalMember(title: string, member: string, records = "payments"): string {
  return `import { Button, StackLayout, Text } from "@salt-ds/core";
import { useBus, useProfile, usePublish } from "@deweb/portal";
import { useState } from "react";
import { ${records} } from "./data";

const rows = ${records} as readonly { readonly id: string; readonly name?: string; readonly beneficiary?: string }[];

export default function PaymentQueue() {
  const profile = useProfile();
  const publish = usePublish(${quote(member)});
  const [selected, setSelected] = useState<string | null>(null);
  useBus("payment:released", ${quote(member)}, (payload) => setSelected(String((payload as { id: string }).id)));
  return (
    <StackLayout gap={1}>
      <Text styleAs="h2">{${quote(title)}}</Text>
      <Text color="secondary">{\`Signed in as \${profile.name}, \${profile.persona}\`}</Text>
      {rows.map((row) => (
        <Button key={row.id} appearance={row.id === selected ? "solid" : "bordered"} onClick={() => publish("payment:selected", { id: row.id })}>
          {row.beneficiary ?? row.name ?? row.id}
        </Button>
      ))}
    </StackLayout>
  );
}
`;
}

/** A portal shell in the mock's voice: the application's routes and the signed-in user, around the route's content. */
export function mockPortalShell(): string {
  return `import { FlexLayout, Link, StackLayout, Text } from "@salt-ds/core";
import { routeHref, useApplication, useProfile, useRoute } from "@deweb/portal";
import type { ReactNode } from "react";

export default function Shell({ children }: { children: ReactNode }) {
  const application = useApplication();
  const profile = useProfile();
  const { current, routes } = useRoute();
  return (
    <StackLayout gap={2}>
      <FlexLayout justify="space-between" align="center">
        <Text styleAs="h2">{application.portal}</Text>
        <Text>{profile.name}</Text>
      </FlexLayout>
      <FlexLayout as="nav" gap={2} aria-label={\`\${application.portal} navigation\`}>
        {routes.map((route) => (
          <Link key={route.path} href={routeHref(route)} aria-current={route.path === current.path ? "page" : undefined}>
            {route.label}
          </Link>
        ))}
      </FlexLayout>
      <StackLayout as="main">{children}</StackLayout>
    </StackLayout>
  );
}
`;
}
