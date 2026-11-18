import { describe, expect, it } from "vitest";
import { TEMPLATES, templateBySlug } from "@/lib/demo/catalog";
import { DEVICES, frameSize, parsePreviewState, previewHref, scaffoldCommand, sizeLabel } from "@/lib/demo/preview";
import { isIllustrative, templateFiles } from "@/lib/demo/template-files";
import { GENERATED_SOURCES } from "@/demo/runtime/generated/sources";
import fabricatePackage from "../../package.json";

describe("preview mode state", () => {
  it("starts on the Preview tab with the Desktop device in landscape", () => {
    expect(parsePreviewState({})).toEqual({ view: "preview", device: "desktop", orientation: "landscape", file: null });
  });

  it("starts Mobile and Tablet in portrait, and keeps a chosen orientation", () => {
    expect(parsePreviewState({ device: "mobile" }).orientation).toBe("portrait");
    expect(parsePreviewState({ device: "tablet" }).orientation).toBe("portrait");
    expect(parsePreviewState({ device: "tablet", orientation: "landscape" }).orientation).toBe("landscape");
    expect(parsePreviewState({ device: "desktop", orientation: "portrait" }).orientation).toBe("portrait");
  });

  it("ignores values it does not know", () => {
    expect(parsePreviewState({ view: "source", device: "watch", orientation: "sideways" })).toEqual({ view: "preview", device: "desktop", orientation: "landscape", file: null });
    expect(parsePreviewState({ view: ["code", "preview"], device: ["mobile"] })).toMatchObject({ view: "code", device: "mobile" });
  });

  it("sizes the frame at each device's size, swapping width and height for the other orientation", () => {
    expect(frameSize("mobile", "portrait")).toEqual({ width: 390, height: 844 });
    expect(frameSize("tablet", "portrait")).toEqual({ width: 820, height: 1180 });
    expect(frameSize("tablet", "landscape")).toEqual({ width: 1180, height: 820 });
    expect(frameSize("desktop", "landscape")).toEqual({ width: 1440, height: 900 });
    expect(frameSize("desktop", "portrait")).toEqual({ width: 900, height: 1440 });
    expect(sizeLabel("tablet", "landscape")).toBe("1180 × 820");
    expect(Object.keys(DEVICES)).toEqual(["mobile", "tablet", "desktop"]);
  });

  it("keeps the choices in the address, leaving out the defaults, so a reload reproduces them", () => {
    expect(previewHref("market-watch", parsePreviewState({}))).toBe("/templates/market-watch/preview");
    const state = parsePreviewState({ view: "code", device: "mobile", file: "microfrontends.json" });
    const href = previewHref("market-watch", state);
    expect(href).toBe("/templates/market-watch/preview?view=code&device=mobile&file=microfrontends.json");
    expect(parsePreviewState(Object.fromEntries(new URL(href, "http://x").searchParams))).toEqual(state);
    expect(previewHref("market-watch", parsePreviewState({ device: "tablet", orientation: "landscape" }))).toBe("/templates/market-watch/preview?device=tablet&orientation=landscape");
  });

  it("names the fictional scaffold command for the template", () => {
    expect(scaffoldCommand("payments-workspace")).toBe("npx @deweb/create-app@latest my-app --template payments-workspace");
  });
});

describe("template files", () => {
  it("lists an illustrative template's package.json first, then microfrontends.json, the README, and one source file per child microfrontend", () => {
    const template = templateBySlug("payment-status-tracker")!;
    expect(isIllustrative(template)).toBe(true);
    expect(templateFiles(template).map((file) => file.path)).toEqual(["package.json", "microfrontends.json", "README.md", ...template.app.members.filter((member) => member.role === "child").map((member) => `apps/${member.id}/src/index.tsx`)]);
  });

  it("shows a hero's real Salt source: its data and each microfrontend at its default version, with the Salt packages it imports (Real source for a hero)", () => {
    const template = templateBySlug("payments-workspace")!;
    const files = templateFiles(template);
    expect(isIllustrative(template)).toBe(false);
    expect(files.map((file) => file.path)).toEqual(["package.json", "microfrontends.json", "README.md", "src/data.ts", "src/payee-list.tsx", "src/transfer-form.tsx", "src/payment-activity.tsx"]);
    const payeeList = files.find((file) => file.path === "src/payee-list.tsx")!.content;
    expect(payeeList).toBe(GENERATED_SOURCES["payments-workspace"]!.members["payee-list"]!["1.4.2"]);
    expect(payeeList).toContain('from "@salt-ds/core"');
    const dependencies = JSON.parse(files[0]!.content).dependencies as Record<string, string>;
    // At the version DE FabLab renders with, so the source runs as shown.
    expect(dependencies["@salt-ds/core"]).toBe(fabricatePackage.dependencies["@salt-ds/core"]);
    expect(dependencies["@deweb/portal"]).toBeDefined();
  });

  it("is the same on every visit", () => {
    for (const template of TEMPLATES) expect(templateFiles(template)).toEqual(templateFiles(templateBySlug(template.slug)!));
  });

  it("lists every member in microfrontends.json, the shell as the default application and each child with its route or slot", () => {
    for (const template of TEMPLATES) {
      const config = JSON.parse(templateFiles(template).find((file) => file.path === "microfrontends.json")!.content) as { applications: Record<string, { default?: boolean; version: string; routing?: { paths: string[]; slot?: string }[] }> };
      expect(Object.keys(config.applications).sort(), template.slug).toEqual(template.app.members.map((member) => member.id).sort());
      for (const member of template.app.members) {
        const entry = config.applications[member.id]!;
        expect(entry.version, member.id).toBe(member.defaultVersion);
        if (member.routing.kind === "shell") expect(entry.default, member.id).toBe(true);
        if (member.routing.kind === "route") expect(entry.routing?.[0]?.paths, member.id).toContain(`/${member.routing.path}`);
        if (member.routing.kind === "slot") expect(entry.routing?.[0], member.id).toEqual({ paths: [`/${member.routing.route}`], slot: member.routing.slot });
      }
    }
    const payments = JSON.parse(templateFiles(templateBySlug("payments-workspace")!)[1]!.content);
    expect(payments.applications["payments-shell"].default).toBe(true);
    expect(payments.applications["transfer-form"].routing).toEqual([{ paths: ["/payees"], slot: "Sidebar" }]);
  });

  it("gives the scaffold command and the routes in the README, and pins each microfrontend in package.json", () => {
    const template = templateBySlug("market-watch")!;
    const [pkg, , readme] = templateFiles(template);
    expect(readme!.content).toContain("npx @deweb/create-app@latest my-app --template market-watch");
    for (const route of template.app.routes) expect(readme!.content).toContain(`/${route.path}`);
    const dependencies = (JSON.parse(pkg!.content) as { dependencies: Record<string, string> }).dependencies;
    for (const member of template.app.members) expect(dependencies[`@deweb/${member.id}`]).toBe(member.defaultVersion);
  });
});
