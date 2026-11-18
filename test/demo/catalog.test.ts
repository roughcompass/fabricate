import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRAND_IDS,
  BRANDS,
  BUILT_IN_PROFILES,
  PERSONAS,
  REFERENCE_PREFIX,
  TEMPLATES,
  type AppDefinition,
  builtInProfile,
  builtInProfileFor,
  loadSequence,
  memberById,
  referenceTemplate,
  routeByPath,
  routingLabel,
  shellOf,
  startRoute,
  templateBySlug,
} from "@/lib/demo/catalog";

const heroes = TEMPLATES.filter((template) => template.hero);
const children = (app: AppDefinition) => app.members.filter((member) => member.role === "child");

// The catalog contract from the template-gallery and portal-runtime specs.
describe("template catalog", () => {
  it("has at least 16 templates with unique slugs", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(16);
    expect(new Set(TEMPLATES.map((template) => template.slug)).size).toBe(TEMPLATES.length);
    for (const template of TEMPLATES) expect(template.slug).toMatch(/^[a-z][a-z0-9-]{2,60}$/);
  });

  it("has exactly one hero per brand and at least three templates per brand", () => {
    expect(heroes.map((template) => template.brand).sort()).toEqual([...BRAND_IDS].sort());
    for (const brand of BRAND_IDS) expect(TEMPLATES.filter((template) => template.brand === brand).length, brand).toBeGreaterThanOrEqual(3);
  });

  it("represents both providers, naming the author of every community template", () => {
    expect(new Set(TEMPLATES.map((template) => template.provider))).toEqual(new Set(["de-web", "community"]));
    for (const template of TEMPLATES) {
      if (template.provider === "community") expect(template.author, template.slug).toMatch(/\S/);
      else expect(template.author, template.slug).toBeUndefined();
    }
  });

  it("gives every template a short description, tags, a version, and a preview with a text alternative", () => {
    for (const template of TEMPLATES) {
      const sentences = template.description.split(/(?<=\.)\s+/).filter(Boolean);
      expect(sentences.length, template.slug).toBeGreaterThanOrEqual(1);
      expect(sentences.length, template.slug).toBeLessThanOrEqual(2);
      expect(template.tags.length, template.slug).toBeGreaterThan(0);
      expect(template.version, template.slug).toMatch(/^\d+\.\d+\.\d+$/);
      expect(template.preview.alt, template.slug).toContain(template.title);
      expect(template.preview.alt, template.slug).toContain(BRANDS[template.brand].portalName);
    }
  });

  it("points every preview at a committed image", () => {
    for (const template of TEMPLATES) {
      expect(template.preview.src, template.slug).toBe(`/demo/previews/${template.slug}.jpg`);
      expect(fs.existsSync(path.join("public", template.preview.src)), template.preview.src).toBe(true);
    }
  });

  it("finds templates and reference deployments by slug", () => {
    expect(templateBySlug("market-watch")?.title).toBe("Market watch");
    expect(templateBySlug("nope")).toBeUndefined();
    expect(referenceTemplate(`${REFERENCE_PREFIX}market-watch`)?.slug).toBe("market-watch");
    expect(referenceTemplate("market-watch")).toBeUndefined();
  });

  describe.each(TEMPLATES.map((template) => [template.slug, template] as const))("%s group", (_slug, template) => {
    const { app } = template;

    it("has one default member, its brand's portal shell, plus child members with unique IDs", () => {
      expect(app.members.filter((member) => member.role === "default")).toHaveLength(1);
      expect(shellOf(app).routing.kind).toBe("shell");
      // Payments, Global Banking, and Other share the Access shell; Markets has its own.
      expect(shellOf(app).name).toMatch(BRANDS[template.brand].shell === "access" ? /^Access shell for / : /^Markets shell$/);
      expect(new Set(app.members.map((member) => member.id)).size).toBe(app.members.length);
      expect(children(app).length).toBeGreaterThanOrEqual(template.hero ? 3 : 2);
    });

    it("gives every member an owner, versions that include its default, and a positive load time", () => {
      for (const member of app.members) {
        expect(member.owner, member.id).toMatch(/\S/);
        expect(member.versions.map((version) => version.version), member.id).toContain(member.defaultVersion);
        expect(new Set(member.versions.map((version) => version.version)).size, member.id).toBe(member.versions.length);
        expect(member.loadMs, member.id).toBeGreaterThan(0);
        expect(member.swapMs, member.id).toBeGreaterThan(0);
      }
    });

    it("has routes whose owners and regions are members, and members whose routing matches the routes", () => {
      expect(app.routes.length).toBeGreaterThan(0);
      for (const route of app.routes) {
        expect(memberById(app, route.owner), route.path).toBeDefined();
        for (const region of route.regions) expect(memberById(app, region.member), `${route.path}/${region.member}`).toBeDefined();
        expect(route.regions.some((region) => region.member === route.owner), route.path).toBe(true);
      }
      for (const member of children(app)) {
        const routing = member.routing;
        if (routing.kind === "route") expect(routeByPath(app, routing.path)?.owner, member.id).toBe(member.id);
        if (routing.kind === "slot") expect(routeByPath(app, routing.route)?.regions.some((region) => region.member === member.id), member.id).toBe(true);
      }
    });

    it("pairs every published topic with a different subscriber", () => {
      for (const member of app.members) {
        for (const topic of member.publishes ?? []) {
          expect(app.members.some((other) => other.id !== member.id && other.subscribes?.includes(topic)), `${member.id} publishes ${topic}`).toBe(true);
        }
      }
    });
  });

  describe.each(heroes.map((template) => [template.slug, template] as const))("%s hero contract", (_slug, template) => {
    const { app } = template;

    it("has a member with three versions that include a prerelease, starting on a stable one", () => {
      const member = children(app).find((entry) => entry.versions.length >= 3)!;
      expect(member, template.slug).toBeDefined();
      expect(member.versions.some((entry) => entry.prerelease)).toBe(true);
      expect(member.versions.find((entry) => entry.version === member.defaultVersion)!.prerelease).toBeFalsy();
      expect(new Set(member.versions.map((entry) => entry.summary)).size).toBe(member.versions.length);
    });

    it("has one member slower to load than any other, on its start route, so the waterfall shows a hot spot (One microfrontend loads slowly)", () => {
      const slowest = [...app.members].sort((left, right) => right.loadMs - left.loadMs)[0]!;
      expect(slowest.loadMs).toBeGreaterThanOrEqual(1200);
      for (const member of app.members.filter((other) => other !== slowest)) expect(member.loadMs, member.id).toBeLessThan(slowest.loadMs);
      expect(startRoute(app).regions.some((region) => region.member === slowest.id)).toBe(true);
    });

    it("has a bus publisher and a different subscriber, and content that changes for the Approver role", () => {
      expect(app.members.some((member) => member.publishes?.length)).toBe(true);
      expect(app.members.some((member) => member.subscribes?.length)).toBe(true);
      expect(app.members.some((member) => member.roleDependent)).toBe(true);
    });

    it("has a second route, so the zone indicator can change on navigation", () => {
      expect(app.routes.length).toBeGreaterThanOrEqual(2);
      expect(new Set(app.routes.map((route) => route.owner)).size).toBe(app.routes.length);
    });
  });

  describe.each(TEMPLATES.filter((template) => !template.hero).map((template) => [template.slug, template] as const))("%s lighter template contract", (_slug, template) => {
    const [main, side] = children(template.app);

    it("has a main member that owns its route with two visibly different versions, and a side member in that route's sidebar (Lighter template composition)", () => {
      expect(children(template.app)).toHaveLength(2);
      expect(main!.routing).toEqual({ kind: "route", path: template.app.routes[0]!.path });
      expect(main!.versions.map((version) => version.version)).toEqual(["1.0.0", "1.1.0"]);
      expect(main!.versions[0]!.summary).not.toBe(main!.versions[1]!.summary);
      expect(side!.routing).toEqual({ kind: "slot", route: template.app.routes[0]!.path, slot: "Sidebar" });
    });

    it("publishes the main member's selection to the side member", () => {
      expect(main!.publishes).toHaveLength(1);
      expect(side!.subscribes).toEqual(main!.publishes);
    });
  });

  it("offers a built-in profile for each persona, keeping the persona ids", () => {
    expect(BUILT_IN_PROFILES.map((profile) => [profile.id, profile.name, profile.persona, profile.region])).toEqual([
      ["analyst", "Jordan Lee", "Analyst", "London"],
      ["approver", "Sam Rivera", "Approver", "New York"],
      ["administrator", "Alex Morgan", "Administrator", "Singapore"],
    ]);
    expect(PERSONAS.map((persona) => builtInProfileFor(persona).persona)).toEqual(["Analyst", "Approver", "Administrator"]);
    expect(builtInProfile("approver")?.name).toBe("Sam Rivera");
    expect(builtInProfile("nobody")).toBeUndefined();
  });

  it("describes routing for operators", () => {
    const app = templateBySlug("payments-workspace")!.app;
    expect(routingLabel(shellOf(app))).toBe("All routes");
    expect(routingLabel(memberById(app, "payee-list")!)).toBe("Route /payees");
    expect(routingLabel(memberById(app, "transfer-form")!)).toBe("Slot Sidebar on /payees");
  });
});

describe("scripted load sequence", () => {
  const app = templateBySlug("payments-workspace")!.app;

  it("loads the shell first, then each region in order, the same way every time", () => {
    const first = loadSequence(app, startRoute(app), {});
    expect(first.map((entry) => entry.member)).toEqual(["payments-shell", "payee-list", "transfer-form", "payment-activity"]);
    expect(first[0]).toMatchObject({ startMs: 0, durationMs: 160 });
    expect(first.slice(1).every((entry) => entry.startMs >= first[0]!.durationMs)).toBe(true);
    expect(loadSequence(app, startRoute(app), {})).toEqual(first);
  });

  it("records overridden versions", () => {
    const sequence = loadSequence(app, startRoute(app), { "payee-list": "2.0.0" });
    expect(sequence.find((entry) => entry.member === "payee-list")?.version).toBe("2.0.0");
  });
});
