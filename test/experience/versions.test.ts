import { beforeEach, describe, expect, it } from "vitest";
import { StaleRecordError, TransitionError } from "@/lib/db/errors";
import type { Db } from "@/lib/db/client";
import { catalogs } from "@/lib/experience/catalogs";
import type { Experience } from "@/lib/experience/document";
import { ExperienceValidationError, currentExperience, experienceVersions, saveExperience, savedMenu } from "@/lib/experience/versions";
import { menuOf } from "@/lib/onboarding/navigation";
import { getPortal, portalHistory, promotePortal } from "@/lib/onboarding/portals";
import { registerApplication } from "../support/applications";
import { createTestDb } from "../support/db";
import { ana, cy, onboardPortal } from "../support/onboarding";

/*
 * Saving a Portal's experience (add-portal-experience-editor task 1.5): the
 * first save is version 1; stale and invalid saves write nothing; the menu is
 * rewritten from the document, keeping its ids; promotion sees the saved
 * default route.
 */

describe("saving an experience", () => {
  let db: Db;
  let access: ReturnType<typeof onboardPortal>;
  let payeeHub: ReturnType<typeof registerApplication>;
  beforeEach(() => {
    db = createTestDb();
    access = onboardPortal(db, "Access");
    payeeHub = registerApplication(db, { name: "Payee Hub", portal: access });
  });

  const current = () => currentExperience(db, getPortal(db, access.publicId), catalogs());
  const save = (document: Experience, baseNumber = current().number, lockVersion = getPortal(db, access.publicId).lockVersion, actor = ana) => saveExperience(db, access.publicId, { baseNumber, lockVersion, document }, actor, catalogs());
  const withMenu = (experience: Experience): Experience => ({
    ...experience,
    menu: [
      { id: "tmp_group", parentId: null, kind: "group", label: "Payments", route: null, application: null, isDefault: false },
      { id: "tmp_payees", parentId: "tmp_group", kind: "item", label: "Payees", route: "/payees", application: payeeHub.publicId, isDefault: true },
    ],
  });

  it("starts from the default and saves version 1, recorded in the history", () => {
    expect(current().number).toBe(0);
    const document = withMenu(current().experience);
    document.copyright = "© JPMorgan";
    const { version } = save(document);
    expect(version).toMatchObject({ number: 1, changeCount: 3, actor: "ana@example.com", attribution: "unverified" });
    expect(current()).toMatchObject({ number: 1, experience: { copyright: "© JPMorgan" } });
    expect(experienceVersions(db, access.id).map((entry) => entry.number)).toEqual([1]);
    expect(portalHistory(db, access.id)[0]).toMatchObject({ event: "experience_saved", detail: expect.stringContaining("Saved version 1 with 3 changes") });
  });

  it("rewrites the menu from the document, giving new entries lasting ids and keeping existing ones", () => {
    save(withMenu(current().experience));
    const menu = savedMenu(db, access.id);
    expect(menu.map((node) => [node.label, node.id.startsWith("mnu_"), node.parentId === menu[0]!.id])).toEqual([
      ["Payments", true, false],
      ["Payees", true, true],
    ]);
    const next = current().experience;
    next.menu = next.menu.map((node) => (node.label === "Payees" ? { ...node, label: "Payee list" } : node));
    save(next);
    const renamed = savedMenu(db, access.id);
    expect(renamed.map((node) => node.id)).toEqual(menu.map((node) => node.id));
    expect(menuOf(db, access.id).map((entry) => entry.label)).toEqual(["Payments", "Payee list"]);
  });

  it("refuses a save based on an older version or lock version, writing nothing", () => {
    const first = current();
    const document = structuredClone(first.experience);
    document.copyright = "© One";
    save(document, first.number, access.lockVersion);
    const other = structuredClone(first.experience);
    other.copyright = "© Two";
    expect(() => save(other, first.number, getPortal(db, access.publicId).lockVersion, cy)).toThrow(StaleRecordError);
    expect(() => save(other, 1, access.lockVersion, cy)).toThrow(StaleRecordError);
    expect(experienceVersions(db, access.id)).toHaveLength(1);
  });

  it("refuses an invalid document with its issues, and one with nothing to change", () => {
    const document = current().experience;
    document.favicon.dataUrl = "https://example.com/icon.png";
    expect(() => save(document)).toThrow(ExperienceValidationError);
    try {
      save(document);
    } catch (error) {
      expect((error as ExperienceValidationError).issues.map((issue) => [issue.path, issue.section])).toEqual([["favicon.dataUrl", "favicon"]]);
    }
    expect(() => save(current().experience)).toThrow(TransitionError);
    expect(experienceVersions(db, access.id)).toHaveLength(0);
  });

  it("lets promotion see the saved default route", () => {
    save(withMenu(current().experience));
    const promoted = promotePortal(db, access.publicId, { lockVersion: getPortal(db, access.publicId).lockVersion }, ana);
    expect(promoted.lifecycle).toBe("production");
  });
});
