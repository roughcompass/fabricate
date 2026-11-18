import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { routeHref, useBus, useProfile, usePublish, useRoute } from "@deweb/portal";
import { templateBySlug } from "@/lib/demo/catalog";
import { createBus } from "@/demo/runtime/bus";
import type { RuntimeDescriptor } from "@/demo/runtime/descriptor";
import { createProfilesStore } from "@/demo/runtime/profiles";
import { type Runtime, RuntimeContext } from "@/demo/runtime/runtime-context";
import { createViewStore } from "@/demo/runtime/view-store";

// converge-templates-and-prototypes, design decision 5: `@deweb/portal` in the running portal is the runtime context's own.

vi.mock("next/navigation", () => ({ usePathname: () => "/run/app_payments000000000/activity", useSearchParams: () => new URLSearchParams("embed=1") }));
// Server rendering skips effects; running them in place lets a subscription reach the bus.
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useEffect: (effect: () => void) => void effect(), useEffectEvent: <T,>(handler: T) => handler };
});

function runtime(): Runtime {
  const template = templateBySlug("payments-workspace")!;
  const descriptor = { applicationId: "app_payments000000000", applicationName: "Payments", templateSlug: template.slug, environment: "sandbox", access: "owner", viewKey: "test", shareState: null, shareToken: null, displayName: null, profiles: [], url: "", status: "ready", pageHref: "" } as unknown as RuntimeDescriptor;
  return { descriptor, template, app: template.app, store: createViewStore(template.app, "sandbox", "test", null, null), bus: createBus(), profiles: createProfilesStore([]), sharedProfile: null };
}

function render(context: Runtime, component: () => null): void {
  renderToStaticMarkup(createElement(RuntimeContext, { value: context }, createElement(component)));
}

describe("@deweb/portal in the running portal", () => {
  it("publishes and subscribes on the runtime's bus, recorded with the publishing member", () => {
    const context = runtime();
    const received: unknown[] = [];
    let publish: ((topic: string, payload: unknown) => void) | undefined;
    render(context, () => {
      useBus("payee:selected", "transfer-form", (payload) => received.push(payload));
      publish = usePublish("payee-list");
      return null;
    });

    publish!("payee:selected", { id: "northwind" });

    expect(received).toEqual([{ id: "northwind" }]);
    expect(context.bus.messages()).toEqual([expect.objectContaining({ topic: "payee:selected", publisher: "payee-list", receivers: ["transfer-form"] })]);
  });

  it("reads the active session profile from the runtime", () => {
    let profile: ReturnType<typeof useProfile> | undefined;
    render(runtime(), () => {
      profile = useProfile();
      return null;
    });
    expect(profile).toEqual({ name: expect.any(String), persona: expect.any(String), region: expect.any(String) });
    expect(Object.keys(profile!)).toEqual(["name", "persona", "region"]);
  });

  it("names the current route and every route's address, keeping the view embedded", () => {
    let routes: ReturnType<typeof useRoute> | undefined;
    render(runtime(), () => {
      routes = useRoute();
      return null;
    });
    expect(routes!.current).toEqual({ path: "activity", label: "Activity", href: "/run/app_payments000000000/activity?embed=1" });
    expect(routes!.routes.map((route) => route.path)).toContain("payees");
    expect(routeHref(routes!.routes.find((route) => route.path === "payees")!)).toBe("/run/app_payments000000000/payees?embed=1");
  });
});
