import { Button, StackLayout, Text } from "@salt-ds/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useProfile } from "@deweb/portal";
import { TEMPLATES, templateBySlug } from "@/lib/demo/catalog";
import { createBus } from "@/demo/runtime/bus";
import type { RuntimeDescriptor } from "@/demo/runtime/descriptor";
import { createProfilesStore } from "@/demo/runtime/profiles";
import { MEMBER_VERSIONS } from "@/demo/runtime/registry";
import { type Runtime, RuntimeContext } from "@/demo/runtime/runtime-context";
import { PortalRoot } from "@/demo/runtime/portal-root";
import { createViewStore } from "@/demo/runtime/view-store";

// update-templates-salt-quality, design decision 3: every template's committed members render in the runtime under Salt's provider.

vi.mock("next/navigation", () => ({ usePathname: () => "/run/app_payments000000000/payees", useSearchParams: () => new URLSearchParams() }));

/** A member as templates write one: Salt components and the portal interface. */
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

describe("template members in the runtime", () => {
  it("cover every version of every built-in template's microfrontends, from committed source", () => {
    for (const template of TEMPLATES) {
      for (const member of template.app.members.filter((entry) => entry.role === "child")) {
        for (const version of member.versions) expect(MEMBER_VERSIONS[member.id]?.[version.version], `${template.slug} ${member.id}@${version.version}`).toBeTypeOf("function");
      }
    }
  });

  it("render as Salt inside the portal's root, in the view's mode, with the portal's session profile", () => {
    const html = renderToStaticMarkup(createElement(RuntimeContext, { value: runtime() }, createElement(PortalRoot, null, createElement(GeneratedPayeeList))));

    expect(html).toMatch(/<div (?=[^>]*data-demo-portal="")(?=[^>]*class="[^"]*salt-theme[^"]*")[^>]*>/);
    expect(html).toContain('data-mode="light"');
    expect(html).toMatch(/class="[^"]*saltButton[^"]*"/);
    expect(html).toContain("Pay Northwind Supplies");
    expect(html).toMatch(/Signed in as \S/);
  });
});
