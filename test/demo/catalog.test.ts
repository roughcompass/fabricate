import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRAND_IDS,
  BRANDS,
  PERSONAS,
  REFERENCE_PREFIX,
  TEMPLATES,
  type AppDefinition,
  loadSequence,
  memberById,
  plantedVersions,
  referenceTemplate,
  routeByPath,
  routingLabel,
  shellOf,
  stagesFor,
  startRoute,
  templateBySlug,
  totalDuration,
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

    it("has a member with three versions including a prerelease, whose defective default is fixed by the next version", () => {
      const planted = plantedVersions(app);
      expect(planted.length).toBeGreaterThanOrEqual(1);
      const { member, version } = planted[0]!;
      const versions = member.versions.map((entry) => entry.version);
      expect(versions.length).toBeGreaterThanOrEqual(3);
      expect(member.versions.some((entry) => entry.prerelease)).toBe(true);
      // The defective version is the default, so every audit story starts with something to find.
      expect(member.defaultVersion).toBe(version);
      const fixed = member.versions[versions.indexOf(version) + 1]!;
      expect(fixed.planted ?? []).toEqual([]);
      expect(fixed.prerelease).toBeFalsy();
    });

    it("plants a missing label, insufficient contrast, and an unnamed control in the defective version only", () => {
      const { member, version } = plantedVersions(app)[0]!;
      const rules = member.versions.find((entry) => entry.version === version)!.planted;
      expect(rules).toEqual(expect.arrayContaining(["label", "color-contrast"]));
      expect(rules?.some((rule) => rule === "button-name" || rule === "image-alt")).toBe(true);
      expect(plantedVersions(app)).toHaveLength(1);
    });

    it("has exactly one slow member, slower to load than any other and with an interaction of at least 600 ms", () => {
      const slow = app.members.filter((member) => member.slowInteraction);
      expect(slow).toHaveLength(1);
      expect(slow[0]!.loadMs).toBeGreaterThanOrEqual(1200);
      expect(slow[0]!.slowInteraction!.blockMs).toBeGreaterThanOrEqual(600);
      for (const member of app.members.filter((other) => other !== slow[0])) expect(member.loadMs, member.id).toBeLessThan(slow[0]!.loadMs);
    });

    it("loads the slow member on its start route, so the first waterfall shows the hot spot", () => {
      const slow = app.members.find((member) => member.slowInteraction)!;
      expect(startRoute(app).regions.some((region) => region.member === slow.id)).toBe(true);
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

  it("plants no defects or slow members outside the heroes", () => {
    for (const template of TEMPLATES.filter((entry) => !entry.hero)) {
      expect(plantedVersions(template.app), template.slug).toEqual([]);
      expect(template.app.members.some((member) => member.slowInteraction), template.slug).toBe(false);
    }
  });

  it("offers an Analyst, an Approver, and an Administrator persona", () => {
    expect(PERSONAS.map((persona) => persona.role)).toEqual(["Analyst", "Approver", "Administrator"]);
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

describe("build stage scripts", () => {
  const context = { templateSlug: "payments-workspace", templateVersion: "3.2.0", url: "https://payments-workspace-k3f9.sandbox.deweb.example" };

  it("runs a sandbox build in about 10 seconds through the specified stages", () => {
    const stages = stagesFor("sandbox", context);
    expect(stages.map((stage) => stage.name)).toEqual(["Queued", "Cloning template", "Installing dependencies", "Building", "Deploying to sandbox", "Assigning URL"]);
    expect(totalDuration(stages)).toBeGreaterThanOrEqual(9000);
    expect(totalDuration(stages)).toBeLessThanOrEqual(11000);
  });

  it("runs a dev build in about 15 seconds, naming the BitBucket project and repository", () => {
    const stages = stagesFor("dev", { ...context, project: "PAY", repository: "payee-portal", repositoryUrl: "https://bitbucket.deweb.example/projects/PAY/repos/payee-portal" });
    expect(stages.map((stage) => stage.name)).toEqual([
      "Queued",
      "Creating BitBucket repository PAY/payee-portal",
      "Pushing initial commit",
      "Running pipeline #1",
      "Installing dependencies",
      "Building",
      "Deploying to dev",
      "Assigning URL",
    ]);
    expect(totalDuration(stages)).toBeGreaterThanOrEqual(14000);
    expect(totalDuration(stages)).toBeLessThanOrEqual(16000);
  });
});
