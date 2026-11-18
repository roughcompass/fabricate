import { Button, StackLayout, Text } from "@salt-ds/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useProfile } from "@deweb/portal";
import { templateBySlug } from "@/lib/demo/catalog";
import { createBus } from "@/demo/runtime/bus";
import type { RuntimeDescriptor } from "@/demo/runtime/descriptor";
import { createProfilesStore } from "@/demo/runtime/profiles";
import { MEMBER_VERSIONS, withGenerated } from "@/demo/runtime/registry";
import { type Runtime, RuntimeContext } from "@/demo/runtime/runtime-context";
import { PortalRoot } from "@/demo/runtime/portal-root";
import { createViewStore } from "@/demo/runtime/view-store";

// converge-templates-and-prototypes, design decisions 6 and 11: generated members render in the runtime under Salt's provider.

vi.mock("next/navigation", () => ({ usePathname: () => "/run/app_payments000000000/payees", useSearchParams: () => new URLSearchParams() }));

/** A generated member, as the hero script writes one: Salt components and the portal interface. */
function GeneratedPayeeList() {
  const profile = useProfile();
  return (
    <StackLayout gap={1}>
      <Text styleAs="h2">Payees</Text>
      <Text>{`Signed in as ${profile.name}`}</Text>
      <Button appearance="solid" sentiment="accented">
        Pay Northwind Supplies
      </Button>
    </StackLayout>
  );
}

function runtime(): Runtime {
  const template = templateBySlug("payments-workspace")!;
  const descriptor = { applicationId: "app_payments000000000", applicationName: "Payments", templateSlug: template.slug, environment: "sandbox", access: "owner", viewKey: "test", shareState: null, shareToken: null, displayName: null, profiles: [], url: "", status: "ready", pageHref: "" } as unknown as RuntimeDescriptor;
  return { descriptor, template, app: template.app, store: createViewStore(template.app, "sandbox", "test", null, null), bus: createBus(), profiles: createProfilesStore([]), sharedProfile: null };
}

describe("generated members in the runtime", () => {
  it("take the place of the hand-written versions they name, keeping the others", () => {
    const merged = withGenerated(MEMBER_VERSIONS, { "payee-list": { "2.0.0": GeneratedPayeeList } });
    expect(merged["payee-list"]!["2.0.0"]).toBe(GeneratedPayeeList);
    expect(merged["payee-list"]!["1.4.2"]).toBe(MEMBER_VERSIONS["payee-list"]!["1.4.2"]);
    expect(Object.keys(merged)).toEqual(Object.keys(MEMBER_VERSIONS));
  });

  it("render as Salt inside the portal's root, in the view's mode, with the portal's session profile", () => {
    const merged = withGenerated(MEMBER_VERSIONS, { "payee-list": { "2.0.0": GeneratedPayeeList } });
    const html = renderToStaticMarkup(createElement(RuntimeContext, { value: runtime() }, createElement(PortalRoot, null, createElement(merged["payee-list"]!["2.0.0"]!))));

    expect(html).toMatch(/<div class="[^"]*salt-theme[^"]*"[^>]*data-demo-portal=""/);
    expect(html).toContain('data-mode="light"');
    expect(html).toMatch(/class="[^"]*saltButton[^"]*"/);
    expect(html).toContain("Pay Northwind Supplies");
    expect(html).toMatch(/Signed in as \S/);
  });
});
