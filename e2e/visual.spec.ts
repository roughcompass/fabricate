import fs from "node:fs";
import path from "node:path";
import { expect, expectNoHorizontalOverflow, expectNoNestedBorders, expectNoOverlappingContent, test } from "./support/fixtures";
import { openTool, setView, waitForRegions } from "./support/demo";
import { seedDemoSurfaces, seedOperatorSurfaces, surfaceUrl } from "./support/surfaces";
import { paths } from "./support/paths";
import { evaluate, seedResults } from "./support/results";
import { saveDirectly } from "./support/experience";
import { waitForHydration } from "./support/shell";
import { addItem, setDefault } from "../src/lib/onboarding/navigation";
import { getPortal, promotePortal } from "../src/lib/onboarding/portals";
import { determineRendering, registerApplication } from "../test/support/applications";
import { ana, onboardPortal } from "../test/support/onboarding";

/**
 * Captures every product surface at desktop and mobile width, in the light and
 * dark themes, after checking each for overflow, overlapping content, and
 * nested bordered containers. Run with `npm run test:visual`; screenshots are
 * written to verification/screenshots.
 */

const OUTPUT = path.resolve("verification/screenshots");
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];
const THEMES = ["light", "dark"] as const;

test.skip(!process.env.CAPTURE_SCREENSHOTS, "Set CAPTURE_SCREENSHOTS=1 (npm run test:visual) to capture screenshots.");
test.setTimeout(600_000);

test("captures every product surface at desktop and mobile width, in both themes", async ({ page, db, sourcesDir, baseURL }) => {
  const surfaces = await seedOperatorSurfaces(db, sourcesDir);

  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  for (const theme of THEMES) {
    await page.context().addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const [name, url] of surfaces) {
        await page.goto(surfaceUrl(url));
        // The development server's floating indicator is not part of the product.
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expectNoHorizontalOverflow(page);
        await expectNoOverlappingContent(page);
        await expectNoNestedBorders(page);
        await page.screenshot({ path: path.join(OUTPUT, `${name}-${viewport.name}-${theme}.jpg`), fullPage: true, type: "jpeg", quality: 75 });
      }
    }
  }
  expect(fs.readdirSync(OUTPUT)).toHaveLength(surfaces.length * VIEWPORTS.length * THEMES.length);
});

/**
 * Captures the shell's own states in both themes: the sidebar hidden and the
 * section menu shown after Show all sections on a desktop, and the drawer
 * open on a phone.
 */
test("captures the shell's sidebar states in both themes", async ({ page, db, baseURL }) => {
  const access = onboardPortal(db, "Access");
  const output = path.join(OUTPUT, "shell");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const capture = async (name: string, theme: string) => {
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(output, `${name}-${theme}.jpg`), type: "jpeg", quality: 75 });
  };
  for (const theme of THEMES) {
    await page.context().addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);

    await page.setViewportSize(VIEWPORTS[0]!);
    await page.context().addCookies([{ name: "fabricate-sidebar", value: "hidden", url: baseURL! }]);
    await page.goto(paths.assessments);
    await expect(page.locator("#sidebar")).toBeHidden();
    await capture("sidebar-hidden-desktop", theme);
    await page.context().clearCookies({ name: "fabricate-sidebar" });

    // The Runtime Configuration sub-menu, then Show all sections back to the primary menu.
    await page.goto(`/portals/${access.publicId}`);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Experience Editor" })).toBeVisible();
    await capture("runtime-submenu-desktop", theme);
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Show all sections" }).click();
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Salt Patterns", exact: true })).toBeVisible();
    await capture("section-menu-desktop", theme);

    await page.setViewportSize(VIEWPORTS[1]!);
    await page.goto(paths.repositories);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await capture("drawer-open-mobile", theme);
  }
  expect(fs.readdirSync(output)).toHaveLength(4 * THEMES.length);
});

/**
 * Captures the Portal switcher, closed and open, and the Create Portal dialog
 * at 1440px and 375px in both themes. On a phone the switcher is in the
 * drawer, so the drawer is opened first.
 */
test("captures the Portal switcher and the Create Portal dialog in both themes", async ({ page, db, baseURL }) => {
  const output = path.join(OUTPUT, "portal-switcher");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const name of ["Access", "Markets", "Treasury"]) onboardPortal(db, name);
  const sidebar = page.locator("#sidebar");
  const capture = async (name: string) => {
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(output, `${name}.jpg`), type: "jpeg", quality: 75 });
  };
  const viewports = [{ name: "desktop", width: 1440, height: 900 }, VIEWPORTS[1]!];
  for (const theme of THEMES) {
    await page.context().addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto("/applications");
      await waitForHydration(page);
      if (viewport.name === "mobile") await page.getByRole("button", { name: "Open navigation" }).click();
      const trigger = sidebar.getByRole("button", { name: /^Switch Portal/ });
      await expect(trigger).toBeVisible();
      await capture(`switcher-closed-${viewport.name}-${theme}`);
      await trigger.click();
      await expect(sidebar.locator("[popover]").getByRole("list", { name: "Switch Portal" })).toBeVisible();
      await capture(`switcher-open-${viewport.name}-${theme}`);
      await sidebar.locator("[popover]").getByRole("link", { name: /^Create Portal/ }).click();
      const dialog = page.getByRole("dialog", { name: /^Create/ });
      await expect(dialog).toBeVisible();
      // The dialog slides in from the right; capture it where it settles.
      await dialog.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
      await capture(`create-portal-${viewport.name}-${theme}`);
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(3 * viewports.length * THEMES.length);
});

/**
 * Captures the Applications pages (make-applications-first-class task 11.3)
 * at 1440px and 375px in both themes: the Applications grid and list, the
 * application switcher open, Add application, the full catalog, Create
 * Application, a dashboard, and a Navigation page with Access in Production.
 */
test("captures the Applications pages and a Navigation page in both themes", async ({ page, db, baseURL }) => {
  const output = path.join(OUTPUT, "applications");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const access = onboardPortal(db, "Access");
  const markets = onboardPortal(db, "Markets");
  const payeeHub = determineRendering(db, registerApplication(db, { name: "Payee Hub", portal: access }), "esm");
  determineRendering(db, registerApplication(db, { name: "Ledger", portal: markets }), "module_federation_2");
  registerApplication(db, { name: "Treasury Desk", portal: markets });
  const version = () => getPortal(db, access.publicId).lockVersion;
  addItem(db, access.publicId, { lockVersion: version(), label: "Payments", route: "/payments", application: payeeHub.publicId, parent: null }, ana);
  const payees = addItem(db, access.publicId, { lockVersion: version(), label: "Payees", route: "/payees", application: payeeHub.publicId, parent: null }, ana);
  setDefault(db, access.publicId, { lockVersion: version(), entry: payees.publicId }, ana);
  promotePortal(db, access.publicId, { lockVersion: version() }, ana);

  const pages: [name: string, url: string, ready?: () => Promise<void>][] = [
    ["applications-grid", "/applications?portal=all"],
    ["applications-list", "/applications?portal=all&view=list"],
    [
      "switcher-open",
      "/applications?portal=all",
      async () => {
        await waitForHydration(page);
        await page.locator("[data-shell-header]").getByRole("button", { name: /^Switch Application/ }).click();
        await expect(page.locator("[data-shell-header] [popover]").getByRole("list", { name: "Switch Application" })).toBeVisible();
      },
    ],
    ["add-application", "/applications/new"],
    ["catalog", "/applications/new/templates"],
    ["create-application", "/applications/new/create?starter=salt-starter&from=new"],
    ["dashboard", `/applications/${payeeHub.publicId}`],
    ["navigation", `/portals/${access.publicId}`],
  ];
  const viewports = [{ name: "desktop", width: 1440, height: 900 }, VIEWPORTS[1]!];
  for (const theme of THEMES) {
    await page.context().addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const [name, url, ready] of pages) {
        await page.goto(url);
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (ready) await ready();
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: path.join(output, `${name}-${viewport.name}-${theme}.jpg`), fullPage: !ready, type: "jpeg", quality: 75 });
      }
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(pages.length * viewports.length * THEMES.length);
});

/**
 * Captures the experience editor (add-portal-experience-editor task 7.2) at
 * 1440px and 375px in both themes: its four views, Change history with a
 * pending change, the System messages editor, the menu editor, and the
 * Install dialog. Then an Access and a Markets running portal with a saved
 * experience, in both runtime themes.
 */
test("captures the experience editor and running portals with a saved experience, in both themes", async ({ page, db, baseURL }) => {
  const output = path.join(OUTPUT, "experience");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const access = onboardPortal(db, "Access");
  const desk = onboardPortal(db, "Markets Desk");
  const payeeHub = registerApplication(db, { name: "Payee Hub", portal: access });
  saveDirectly(db, access, (draft) => {
    draft.brand.portalName = "Digital Platform";
    draft.toolkits.installed.push("global-search", "notifications");
    draft.messages.push({ id: "msg_maint", title: "Scheduled maintenance", description: "Saturday 02:00 to 04:00 UTC.", severity: "warning", dismissible: true, enabled: true, startsAt: null, endsAt: null });
    draft.menu = [
      { id: "tmp_group", parentId: null, kind: "group", label: "Cash Management", route: null, application: null, isDefault: false },
      { id: "tmp_payees", parentId: "tmp_group", kind: "item", label: "Payees", route: "/payees", application: payeeHub.publicId, isDefault: true },
    ];
  });
  saveDirectly(db, desk, (draft) => {
    draft.theme.id = "markets";
    draft.frame.sidebar.menuType = "flyout";
  });
  const editor = `/portals/${access.publicId}/editor`;
  const capture = async (name: string, fullPage = false) => {
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(output, `${name}.jpg`), fullPage, type: "jpeg", quality: 75 });
  };
  const viewports = [{ name: "desktop", width: 1440, height: 900 }, VIEWPORTS[1]!];
  const views = ["frame-zones", "frame-overlays", "capabilities", "configuration/brand", "messages", "menu"];
  for (const theme of THEMES) {
    await page.context().addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const suffix = `${viewport.name}-${theme}`;
      for (const view of views) {
        await page.goto(view.startsWith("configuration/") ? `/portals/${access.publicId}/${view}` : `${editor}/${view}`);
        await waitForHydration(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await capture(`${view.replace("/", "-")}-${suffix}`);
      }
      await page.goto(`/portals/${access.publicId}/configuration/copyright`);
      await waitForHydration(page);
      await page.getByLabel("Copyright information").fill("© 2026 JPMorgan Chase & Co. Digital Platform.");
      await page.locator("[data-runtime-actions]").getByRole("link", { name: /^Change history/ }).click();
      await expect(page.getByRole("table", { name: "Pending changes" })).toBeVisible();
      await capture(`change-history-${suffix}`);
      // The Install dialog, for a Portal that hasn't installed Global Search.
      await page.goto(`/portals/${desk.publicId}/editor/capabilities`);
      await waitForHydration(page);
      await page.getByRole("list", { name: "Toolkits" }).getByRole("button", { name: /^Global Search/ }).click();
      await page.getByRole("region", { name: "Options", exact: true }).getByRole("button", { name: "Install" }).click();
      await expect(page.getByRole("dialog", { name: "Install Global Search" })).toBeVisible();
      await capture(`install-dialog-${suffix}`);
      await page.keyboard.press("Escape");
      // Clear the pending change, so the next viewport starts from the saved version.
      await page.evaluate(() => window.sessionStorage.clear());
    }
  }

  // The running portals, in the runtime's own themes.
  const portals: [name: string, url: string][] = [
    ["running-access", `/run/ref-payments-workspace?portal=${access.publicId}`],
    ["running-markets", `/run/ref-market-watch?portal=${desk.publicId}`],
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const [name, url] of portals) {
      await page.goto(url);
      await waitForRegions(page);
      for (const theme of THEMES) {
        await setView(page, { theme });
        await expect(page.locator("[data-demo-portal]")).toHaveAttribute("data-theme", theme);
        await expectNoOverlappingContent(page);
        await capture(`${name}-${viewport.name}-${theme}`);
      }
    }
  }
  expect(fs.readdirSync(output)).toHaveLength((views.length + 2) * viewports.length * THEMES.length + portals.length * viewports.length * THEMES.length);
});

/**
 * Captures the portal management journey (update-portal-management-journey
 * task 7.2) in both themes: Home and its primary menu, the Portals page, the
 * Experience Editor with its header controls at 1440, 1280, and 375 pixels, a
 * configuration page, the device toolbar rotated, Add application, an
 * application dashboard, and the switcher with a long Portal name.
 */
test("captures the portal management journey in both themes", async ({ page, db, baseURL }) => {
  const output = path.join(OUTPUT, "journey");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const access = onboardPortal(db, "Access");
  onboardPortal(db, "Markets");
  const long = onboardPortal(db, "Global Corporate Treasury Operations Portal");
  const payeeHub = registerApplication(db, { name: "Payee Hub", portal: access });
  registerApplication(db, { name: "Ledger", portal: access });
  const { initiative, assessment } = await seedResults(db);
  await evaluate(db, initiative.publicId, assessment.publicId);
  const capture = async (name: string, fullPage = false) => {
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(output, `${name}.jpg`), fullPage, type: "jpeg", quality: 75 });
  };
  let count = 0;
  for (const theme of THEMES) {
    await page.context().addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    await page.context().clearCookies({ name: "fabricate-portal" });
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [name, url] of [["home", "/"], ["portals", "/portals"], ["add-application", "/applications/new"], ["dashboard", `/applications/${payeeHub.publicId}`]] as const) {
      await page.goto(url);
      await waitForHydration(page);
      await capture(`${name}-${theme}`, name !== "add-application");
      count++;
    }
    for (const width of [1440, 1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/portals/${access.publicId}/editor/frame-zones`);
      await waitForHydration(page);
      await page.locator("[data-slot-row='feedback']").getByRole("button", { name: "Show Feedback Slot" }).click();
      await capture(`editor-${width}-${theme}`);
      count++;
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/portals/${access.publicId}/configuration/brand`);
    await waitForHydration(page);
    await capture(`configuration-brand-${theme}`);
    await page.goto(`/portals/${access.publicId}/editor/frame-zones`);
    await waitForHydration(page);
    await page.getByLabel("Device", { exact: true }).selectOption("iphone-14");
    await page.getByRole("button", { name: /^Rotate/ }).click();
    await expect(page.locator("[data-frame-preview]")).toHaveAttribute("data-width", "844");
    await capture(`device-rotated-${theme}`);
    await page.evaluate(() => window.sessionStorage.clear());
    await page.context().addCookies([{ name: "fabricate-portal", value: long.publicId, url: baseURL! }]);
    await page.goto("/applications");
    await waitForHydration(page);
    await capture(`switcher-long-name-${theme}`);
    await page.locator("#sidebar").getByRole("button", { name: /^Switch Portal/ }).click();
    await capture(`switcher-long-name-open-${theme}`);
    count += 4;
  }
  expect(fs.readdirSync(output)).toHaveLength(count);
});

/**
 * Captures each portal shell of the template demo, with its hero application,
 * at desktop and mobile width in both runtime themes. Portals are application
 * content, so only overflow and overlap are checked, not the operator rules.
 */
test("captures every portal shell at desktop and mobile width, in both runtime themes", async ({ page, db: _db }) => {
  const output = path.join(OUTPUT, "portals");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const heroes = ["payments-workspace", "client-onboarding", "market-watch", "operations-console"];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const slug of heroes) {
      await page.goto(`/run/ref-${slug}`);
      await waitForRegions(page);
      for (const theme of THEMES) {
        await setView(page, { theme });
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await expect(page.locator("[data-demo-portal]")).toHaveAttribute("data-theme", theme);
        await expectNoHorizontalOverflow(page);
        await expectNoOverlappingContent(page);
        await page.screenshot({ path: path.join(output, `${slug}-${viewport.name}-${theme}.jpg`), fullPage: true, type: "jpeg", quality: 75 });
      }
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(heroes.length * VIEWPORTS.length * THEMES.length);
});

/**
 * Captures the template demo's operator surfaces: the create page and the
 * import, the gallery, template detail, preview mode on every device and
 * orientation and its Code tab, the deploy form, building and ready
 * applications, and the Applications list. A building application is created
 * just before each capture of it, so it is always mid-build.
 */
test("captures every template demo surface at desktop and mobile width, in both themes", async ({ page, context, db, baseURL }) => {
  const output = path.join(OUTPUT, "demo");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const surfaces = await seedDemoSurfaces(page, context, db);

  for (const theme of THEMES) {
    await context.addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const [name, url] of surfaces) {
        await page.goto(surfaceUrl(url));
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (name.startsWith("13-preview-") && name !== "13-preview-code") {
          const frame = (await (await page.locator("[data-preview-frame]").elementHandle())!.contentFrame())!;
          await frame.waitForFunction(() => document.querySelector("[data-demo-mfe]") && !document.querySelector('[data-demo-mfe]:not([data-demo-state="ready"])'), null, { timeout: 15_000 });
        }
        await page.waitForLoadState("networkidle");
        await expectNoHorizontalOverflow(page);
        await expectNoOverlappingContent(page);
        await expectNoNestedBorders(page);
        await page.screenshot({ path: path.join(output, `${name}-${viewport.name}-${theme}.jpg`), fullPage: true, type: "jpeg", quality: 75 });
      }
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(surfaces.length * VIEWPORTS.length * THEMES.length);
});

/**
 * Captures every Prototypes surface, on a workspace seeded with the
 * committed examples: the list, the composer, personas, lessons, the page
 * shell, a prototype's tabs, the variants it was kept from, compare, accept,
 * and a share link. Frames are captured once they report ready.
 */
test("captures every Prototypes surface at desktop and mobile width, in both themes", async ({ page, context, db: _db, baseURL }) => {
  const output = path.join(OUTPUT, "prototypes");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  await page.request.post("/api/test/prototypes/settings", { data: { examples: true } });
  await page.goto("/prototypes");
  const href = async (row: import("@playwright/test").Locator) => (await row.getByRole("link").first().getAttribute("href"))!;
  const rows = page.locator("[data-prototype]");
  const page3 = await href(rows.filter({ hasText: "v3" }).filter({ hasNotText: "(fork)" }).first());
  const component = await href(rows.filter({ hasText: "Component" }).first());
  await page.goto(page3);
  const variants = (await page.getByRole("link", { name: "See the variants it was kept from" }).getAttribute("href"))!;
  await page.goto(variants);
  const single = (await page.getByRole("link", { name: "View on its own" }).first().getAttribute("href"))!;
  await page.goto(page3);
  await page.getByText("Share or download").click();
  await page.getByRole("button", { name: /^Share v\d+$/ }).click();
  const shared = new URL((await page.locator("[data-share-link] code").textContent())!).pathname;
  await page.goto("/prototypes/personas");
  const persona = (await page.locator("tbody tr").first().getByRole("link").first().getAttribute("href"))!;

  const surfaces: [string, string][] = [
    ["20-prototypes", "/prototypes"],
    ["21-new-prototype", "/prototypes/new"],
    ["22-personas", "/prototypes/personas"],
    ["22-persona", persona],
    ["23-lessons", "/prototypes/lessons"],
    ["23-lessons-progress", "/prototypes/lessons?view=progress"],
    ["23-lessons-check", "/prototypes/lessons?view=check"],
    ["24-page-shell", "/prototypes/shell"],
    ["25-prototype-preview", page3],
    ["25-prototype-checks", `${page3}?tab=checks`],
    ["25-prototype-code", `${page3}?tab=code`],
    ["25-prototype-feedback", `${page3}?tab=feedback`],
    ["25-prototype-provenance", `${page3}?tab=provenance`],
    ["25-component", component],
    ["26-variants", variants],
    ["26-variant", single],
    ["26-variant-landscape", `${single}?device=mobile&orientation=landscape`],
    ["26-variant-code", `${single}?tab=code`],
    ["27-compare", `${page3}/compare?a=1&b=3`],
    ["28-accept", `${page3}/accept`],
    ["29-share", shared],
  ];
  for (const theme of THEMES) {
    await context.addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const [name, url] of surfaces) {
        await page.goto(url);
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const frames = page.locator("iframe[data-prototype-frame]:not([aria-hidden])");
        for (let index = 0; index < (await frames.count()); index++) await expect(frames.nth(index)).toHaveAttribute("data-ready", "", { timeout: 30_000 });
        await page.waitForLoadState("networkidle");
        await expectNoHorizontalOverflow(page);
        await expectNoOverlappingContent(page);
        await expectNoNestedBorders(page);
        await page.screenshot({ path: path.join(output, `${name}-${viewport.name}-${theme}.jpg`), fullPage: true, type: "jpeg", quality: 75 });
      }
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(surfaces.length * VIEWPORTS.length * THEMES.length);
});

/**
 * Captures each hero application with each toolbar tool open, in both
 * application themes, with the toolbar in the matching operator theme.
 */
test("captures each toolbar tool over every hero application, in both themes", async ({ page, context, db: _db, baseURL }) => {
  const output = path.join(OUTPUT, "toolbar");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const heroes = ["payments-workspace", "client-onboarding", "market-watch", "operations-console"];
  const tools: [id: string, dialog: string][] = [
    ["microfrontends", "Microfrontends"],
    ["accessibility", "Accessibility"],
    ["timing", "Timing"],
    ["settings", "Settings"],
    ["share", "Share"],
    ["comments", "Comments"],
  ];
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const theme of THEMES) {
    await context.addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const slug of heroes) {
      await page.goto(`/run/ref-${slug}`);
      await waitForRegions(page);
      await setView(page, { theme });
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      if (theme === "light") {
        // One comment per hero, so the comments list and a pin show.
        await page.keyboard.press("c");
        await page.locator("[data-demo-mfe] [data-demo-anchor]").first().click();
        const composer = page.getByRole("dialog", { name: "New comment" });
        if (await composer.getByLabel("Your name").count()) await composer.getByLabel("Your name").fill("Sam Rivera");
        await composer.getByLabel("Comment", { exact: true }).fill("Can this use the shared component?");
        await composer.getByRole("button", { name: "Post comment" }).click();
        await expect(composer).toBeHidden();
        await page.getByRole("dialog", { name: "Comment 1" }).getByRole("button", { name: "Close comment" }).click();
      }
      for (const [name, dialog] of tools) {
        await openTool(page, name);
        const panel = page.getByRole("dialog", { name: dialog });
        await expect(panel).toBeVisible();
        if (name === "accessibility") {
          await panel.getByRole("button", { name: /Run audit/ }).click();
          await expect(panel.locator("[data-audit-result]").first()).toBeVisible();
        }
        if (name === "share") await expect(panel.getByLabel("Link to this view")).toBeVisible();
        await page.screenshot({ path: path.join(output, `${slug}-${name}-${theme}.jpg`), type: "jpeg", quality: 75 });
      }
      await page.keyboard.press("Escape");
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(heroes.length * tools.length * THEMES.length);
});

/**
 * Captures the toolbar's own states at desktop and 375px widths, in both
 * operator themes: at rest, the open and filtered menu, each tool panel, the
 * Session create form, the composer with its formatting bar, and the hidden
 * tab.
 */
test("captures the toolbar's states at desktop and mobile width, in both operator themes", async ({ page, context, db: _db, baseURL }) => {
  const output = path.join(OUTPUT, "toolbar-states");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const panels: [id: string, dialog: string][] = [
    ["comments", "Comments"],
    ["share", "Share"],
    ["microfrontends", "Microfrontends"],
    ["accessibility", "Accessibility"],
    ["timing", "Timing"],
    ["session", "Session"],
    ["settings", "Settings"],
    ["shortcuts", "Preferences / Keyboard shortcuts"],
  ];
  const menu = page.getByRole("dialog", { name: "Toolbar", exact: true });
  let count = 0;
  const capture = async (name: string, theme: string, viewport: string) => {
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(output, `${name}-${viewport}-${theme}.jpg`), type: "jpeg", quality: 75 });
    count++;
  };
  for (const theme of THEMES) {
    await context.addCookies([{ name: "fabricate-theme", value: theme, url: baseURL! }]);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto("/run/ref-payments-workspace");
      await waitForRegions(page);
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await capture("rest", theme, viewport.name);

      await page.getByRole("button", { name: /^Open toolbar menu/ }).click();
      await expect(menu).toBeVisible();
      await capture("menu", theme, viewport.name);
      await page.keyboard.type("set");
      await capture("menu-filtered", theme, viewport.name);
      await page.keyboard.press("Escape");

      for (const [id, dialog] of panels) {
        await openTool(page, id);
        await expect(page.getByRole("dialog", { name: dialog })).toBeVisible();
        await capture(`panel-${id}`, theme, viewport.name);
        await page.keyboard.press("Escape");
      }

      await openTool(page, "session");
      await page.getByRole("dialog", { name: "Session" }).getByRole("button", { name: "New profile" }).click();
      await expect(page.getByRole("form", { name: "New profile" })).toBeVisible();
      await capture("session-create", theme, viewport.name);
      await page.keyboard.press("Escape");

      await openTool(page, "comment");
      await page.locator('[data-demo-anchor="send-payment"]').click();
      const composer = page.getByRole("dialog", { name: "New comment" });
      await composer.getByLabel("Comment", { exact: true }).fill("Make this **primary**");
      await composer.getByRole("button", { name: "Formatting" }).click();
      await expect(composer.getByRole("group", { name: "Formatting" })).toBeVisible();
      await capture("composer", theme, viewport.name);
      await composer.getByLabel("Comment", { exact: true }).press("Escape");

      await page.keyboard.press(".");
      await expect(page.getByRole("button", { name: "Show toolbar" })).toBeVisible();
      await capture("hidden", theme, viewport.name);
      await page.keyboard.press(".");
    }
  }
  expect(fs.readdirSync(output)).toHaveLength(count);
  expect(count).toBe((panels.length + 6) * VIEWPORTS.length * THEMES.length);
});
