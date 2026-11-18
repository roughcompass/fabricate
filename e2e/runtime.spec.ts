import type { Page } from "@playwright/test";
import { TEMPLATES, templateBySlug } from "../src/lib/demo/catalog";
import { audit, setView, waitForRegions } from "./support/demo";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";

/** Running demo applications: portal shells, microfrontends, and their accessibility and responsiveness (portal-runtime and template-quality specs). */

const ACCESS = "J.P. Morgan Access";
const MARKETS = "J.P. Morgan Markets";

// Each hero's three-version member, the version after its default, and the action in its slowest-loading member.
const HEROES = [
  { slug: "payments-workspace", shell: "access", portal: ACCESS, name: "Access", swapped: "payee-list", next: "2.0.0", action: "Recalculate totals" },
  { slug: "client-onboarding", shell: "access", portal: ACCESS, name: "Access", swapped: "kyc-checklist", next: "3.3.0", action: "Verify all documents" },
  { slug: "market-watch", shell: "markets", portal: MARKETS, name: "Markets", swapped: "watchlist", next: "1.9.0", action: "Recalculate exposure" },
  { slug: "operations-console", shell: "access", portal: ACCESS, name: "Access", swapped: "incident-feed", next: "6.1.0", action: "Check for conflicts" },
] as const;

/** The link home: the J.P. Morgan logo image, then the portal name. */
const home = (page: Page, portal: string) => page.getByRole("link", { name: portal, exact: true });

/** Whether an element lies entirely inside the viewport horizontally. */
async function fullyVisible(page: Page, locator: ReturnType<Page["locator"]>): Promise<boolean> {
  const box = await locator.boundingBox();
  const width = page.viewportSize()!.width;
  return Boolean(box && box.width > 0 && box.x >= 0 && box.x + box.width <= width);
}

const region = (page: Page, member: string) => page.locator(`[data-demo-mfe="${member}"]`);
/**
 * An open header menu: a Salt overlay panel in the Access shell and a Salt menu
 * in the Markets shell, rendered outside the portal root. Found by its label,
 * since Salt names a menu after its trigger.
 */
const panelSelector = (shell: "access" | "markets", name: string) => `[role="${shell === "access" ? "dialog" : "menu"}"][aria-label="${name}"]`;
const headerPanel = (page: Page, shell: "access" | "markets", name: string) => page.locator(panelSelector(shell, name));

test.describe("portal shells", () => {
  for (const hero of HEROES) {
    test(`renders ${hero.slug} in the ${hero.portal} shell, outside the operator shell`, async ({ page, db: _db }) => {
      const template = templateBySlug(hero.slug)!;
      await page.goto(`/run/ref-${hero.slug}`);
      await waitForRegions(page);
      await expect(page).toHaveTitle(`${template.title} · ${hero.portal}`);
      const portal = page.locator("[data-demo-portal]");
      await expect(portal).toHaveAttribute("data-brand", template.brand);
      await expect(portal).toHaveAttribute("data-shell", hero.shell);
      // The J.P. Morgan logo, served from DE FabLab, then the portal name; "J.P. Morgan" is never printed as text.
      await expect(home(page, hero.portal)).toBeVisible();
      await expect(home(page, hero.portal).getByRole("img", { name: "J.P. Morgan" })).toHaveAttribute("src", "/brand/jpmorgan-logo.svg");
      await expect(home(page, hero.portal)).toContainText(hero.name);
      await expect(page.locator('[data-demo-anchor="portal-header"]')).not.toContainText("J.P. Morgan");
      await expect(page.locator('[data-demo-anchor="portal-header"]')).not.toContainText("J.P.Morgan");
      await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
      const navigation = page.getByRole("navigation", { name: `${hero.portal} navigation` });
      for (const route of template.app.routes) await expect(navigation.getByRole("link", { name: route.label })).toBeVisible();
      await expect(navigation.getByRole("link", { name: template.app.routes[0]!.label })).toHaveAttribute("aria-current", "page");
      const user = page.getByRole("button", { name: /Jordan Lee/ });
      await expect(user).toContainText("Analyst · London");
      await user.click();
      await expect(headerPanel(page, hero.shell, "User menu for Jordan Lee")).toContainText("Analyst · London");
      await page.keyboard.press("Escape");
      await expect(headerPanel(page, hero.shell, "User menu for Jordan Lee")).toHaveCount(0);
      await expect(user).toBeFocused();
      await expect(page.getByRole("contentinfo")).toContainText(`An illustrative ${hero.name} shell for the template demo.`);
      await expect(page.getByRole("contentinfo")).toContainText(/© \d{4} JPMorgan Chase & Co\. All rights reserved\./);
      await expect(page.getByRole("contentinfo")).toContainText("Environment: Production");
      expect(await page.locator("[data-demo-mfe]").count()).toBeGreaterThanOrEqual(3);
    });
  }

  test("marks the current route in the Access navigation and ends the breadcrumbs with it", async ({ page, db: _db }) => {
    await page.goto("/run/ref-payments-workspace/activity");
    await waitForRegions(page);
    const navigation = page.getByRole("navigation", { name: `${ACCESS} navigation` });
    await expect(navigation.getByRole("button", { name: "Payments workspace" })).toHaveAttribute("aria-expanded", "true");
    const activity = navigation.getByRole("link", { name: "Activity" });
    await expect(activity).toHaveAttribute("aria-current", "page");
    // Marked as current the way Salt's navigation marks it.
    await expect(activity).toHaveClass(/saltNavigationItem-active/);
    await expect(navigation.getByRole("link", { name: "Payees" })).not.toHaveClass(/saltNavigationItem-active/);
    await expect(navigation.getByRole("link", { name: "Home" })).toBeVisible();
    for (const group of ["Reports and Insights", "Support Hub"]) await expect(navigation.getByRole("button", { name: group })).toHaveAttribute("aria-expanded", "false");
    await navigation.getByRole("button", { name: "Reports and Insights" }).click();
    await expect(navigation.getByText("Statements")).toBeVisible();

    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem");
    await expect(crumbs).toHaveText(["Access", "Payments workspace", "Activity"]);
    await expect(crumbs.last()).toHaveAttribute("aria-current", "page");
    // The portal has no page of its own in the demo, so its crumb is text, not a link.
    await expect(crumbs.first().getByRole("link")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  });

  for (const width of [1280, 375]) {
    test(`keeps the Access header actions and user menu fully visible at ${width}px`, async ({ page, db: _db }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/run/ref-client-onboarding");
      await waitForRegions(page);
      for (const name of ["Help", "Feedback"]) expect(await fullyVisible(page, page.getByRole("button", { name, exact: true })), name).toBe(true);
      expect(await fullyVisible(page, page.getByRole("button", { name: /Jordan Lee/ }))).toBe(true);
      expect(await fullyVisible(page, home(page, ACCESS))).toBe(true);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("opens the Access menu with a workspace switcher, Settings, and Collapse, which narrows it to icons", async ({ page, db: _db }) => {
    await page.goto("/run/ref-payments-workspace");
    await waitForRegions(page);
    const navigation = page.getByRole("navigation", { name: `${ACCESS} navigation` });
    await expect(navigation.getByRole("combobox", { name: "Workspace" })).toHaveText("Corporate Banking");
    await expect(navigation.getByRole("button", { name: "Settings" })).toBeVisible();
    const menu = page.locator('[data-demo-anchor="portal-menu"]');
    const wide = (await menu.boundingBox())!.width;
    await navigation.getByRole("button", { name: "Collapse" }).click();
    await expect(navigation.getByRole("button", { name: "Expand menu" })).toBeVisible();
    await expect(navigation.getByRole("button", { name: "Home" })).toBeVisible();
    expect((await menu.boundingBox())!.width).toBeLessThan(wide / 2);
    await navigation.getByRole("button", { name: "Expand menu" }).click();
    await expect(navigation.getByRole("link", { name: "Activity" })).toBeVisible();
  });

  test("collapses the Access navigation on wide screens and makes it a drawer on narrow ones", async ({ page, db: _db }) => {
    await page.goto("/run/ref-payments-workspace");
    await waitForRegions(page);
    const navigation = page.getByRole("navigation", { name: `${ACCESS} navigation` });
    await page.getByRole("button", { name: "Hide navigation" }).click();
    await expect(navigation).toBeHidden();
    await page.getByRole("button", { name: "Show navigation" }).click();
    await expect(navigation).toBeVisible();

    await page.setViewportSize({ width: 375, height: 800 });
    await expect(navigation).toBeHidden();
    const menu = page.getByRole("button", { name: "Show navigation" });
    await menu.click();
    await expect(navigation).toBeVisible();
    // The drawer opens on its first control, the workspace switcher.
    await expect(navigation.getByRole("combobox", { name: "Workspace" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(navigation).toBeHidden();
    await expect(menu).toBeFocused();
    await menu.click();
    await navigation.getByRole("link", { name: "Activity" }).click();
    await expect(page).toHaveURL(/\/activity$/);
    await expect(navigation).toBeHidden();
  });

  test("navigates the Markets shell's route tabs, marking the current one, under a title band in Salt's display typography", async ({ page, db: _db }) => {
    await page.goto("/run/ref-market-watch");
    await waitForRegions(page);
    await expect(page.getByRole("navigation", { name: `${MARKETS} sections` }).getByRole("link", { name: "Market watch" })).toHaveAttribute("aria-current", "page");
    const openMenu = page.getByRole("button", { name: "Open menu" });
    await openMenu.click();
    const flyout = page.getByRole("navigation", { name: `${MARKETS} menu` });
    await expect(flyout.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(flyout.getByRole("link", { name: "Watch" })).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
    await expect(flyout).toBeHidden();
    await expect(openMenu).toBeFocused();
    const tabs = page.getByRole("navigation", { name: `${MARKETS} navigation` });
    await tabs.getByRole("link", { name: "Blotter" }).click();
    await expect(page).toHaveURL(/\/run\/ref-market-watch\/blotter$/);
    const blotter = tabs.getByRole("link", { name: "Blotter" });
    await expect(blotter).toHaveAttribute("aria-current", "page");
    await expect(blotter).toHaveClass(/saltNavigationItem-active/);
    await expect(tabs.getByRole("link", { name: "Watch" })).not.toHaveClass(/saltNavigationItem-active/);
    const title = page.getByRole("heading", { level: 1, name: "Blotter" });
    await expect(title).toBeVisible();
    await expect(title).toHaveClass(/saltText-display/);
    // The band contrasts with the content area around it.
    const [band, surface] = await title.evaluate((element) => [getComputedStyle(element.parentElement!.parentElement!).backgroundColor, getComputedStyle(document.querySelector('[data-demo-anchor="portal-header"]')!).backgroundColor]);
    expect(band).not.toBe(surface);
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("img", { name: "J.P. Morgan" })).toBeVisible();
    // Placeholder portal links: the legal entries are plain text, not links.
    for (const entry of ["Terms of Use", "Disclosures", "Security", "Privacy", "Cookies Policy", "Contact Us"]) await expect(footer.getByText(entry, { exact: true })).toBeVisible();
    await expect(footer.getByRole("link")).toHaveCount(0);
  });

  for (const hero of [HEROES[0], HEROES[2]]) {
    test(`switches the ${hero.portal} shell to Salt's dark mode, where every shell text and control meets contrast`, async ({ page, db: _db }) => {
      await page.goto(`/run/ref-${hero.slug}`);
      await waitForRegions(page);
      const rgb = (value: string) => value.match(/\d+/g)!.slice(0, 3).map(Number);
      const surfaces = () => page.locator('[data-demo-anchor="portal-header"]').evaluate((element) => [getComputedStyle(element).backgroundColor, getComputedStyle(element).color]);
      const [lightBar] = await surfaces();
      await setView(page, { theme: "dark" });
      await expect(page.locator("[data-demo-portal]")).toHaveAttribute("data-mode", "dark");
      const [darkBar] = await surfaces();
      expect(darkBar).not.toBe(lightBar);
      expect(Math.max(...rgb(darkBar!))).toBeLessThan(64);
      expect(await audit(page)).toEqual([]);
    });
  }

  for (const hero of [HEROES[0], HEROES[2]]) {
    test(`keeps the ${hero.portal} header menus free of violations while they are open`, async ({ page, db: _db }) => {
      await page.goto(`/run/ref-${hero.slug}`);
      await waitForRegions(page);
      const menus = ["Help", "Feedback"];
      for (const name of [...menus, "User menu for Jordan Lee"]) {
        const control = name.startsWith("User menu") ? page.getByRole("button", { name: /Jordan Lee/ }) : page.getByRole("button", { name, exact: true });
        await control.click();
        const menu = headerPanel(page, hero.shell, name);
        await expect(menu).toBeVisible();
        expect(await audit(page, [panelSelector(hero.shell, name)]), name).toEqual([]);
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
      }
    });
  }

  test("navigates between an application's routes inside the shell", async ({ page, db: _db }) => {
    await page.goto("/run/ref-payments-workspace");
    await waitForRegions(page);
    await page.getByRole("navigation", { name: `${ACCESS} navigation` }).getByRole("link", { name: "Activity" }).click();
    await expect(page).toHaveURL(/\/run\/ref-payments-workspace\/activity$/);
    await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
    await waitForRegions(page);
    await expect(page.locator("[data-demo-mfe]")).toHaveCount(1);
    await expect(region(page, "payment-activity")).toBeVisible();
  });

  test("answers not found for a route the application does not have", async ({ page, db: _db }) => {
    const response = await page.goto("/run/ref-payments-workspace/nowhere");
    expect(response?.status()).toBe(404);
  });
});

test.describe("scripted loading", () => {
  test("loads the shell first and the regions in the same order on every visit", async ({ page, db: _db }) => {
    await page.addInitScript(() => {
      const order: string[] = [];
      (window as unknown as { __readyOrder: string[] }).__readyOrder = order;
      new MutationObserver((records) => {
        for (const record of records) {
          const element = record.target as HTMLElement;
          if (record.attributeName === "data-demo-state" && element.dataset.demoState === "ready" && element.dataset.demoMfe) order.push(element.dataset.demoMfe);
        }
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-demo-state"] });
    });
    const orders: string[][] = [];
    for (let visit = 0; visit < 3; visit++) {
      await page.goto("/run/ref-payments-workspace");
      // The shell is visible before any region has loaded.
      await expect(home(page, ACCESS)).toBeVisible();
      await waitForRegions(page);
      orders.push(await page.evaluate(() => (window as unknown as { __readyOrder: string[] }).__readyOrder));
    }
    expect(orders[0]).toEqual(["payee-list", "transfer-form", "payment-activity"]);
    expect(orders[1]).toEqual(orders[0]);
    expect(orders[2]).toEqual(orders[0]);
  });
});

test.describe("event bus", () => {
  test("updates the chart and the order ticket when an instrument is selected in the watchlist", async ({ page, db: _db }) => {
    await page.goto("/run/ref-market-watch");
    await waitForRegions(page);
    await page.locator('[data-demo-anchor="chart-GLBX"]').click();
    await expect(region(page, "price-chart").getByRole("heading", { name: "Price chart · GLBX" })).toBeVisible();
    await expect(region(page, "order-ticket")).toContainText("GLBX · Globex Holdings");
  });

  test("fills the transfer form's payee when a payee is chosen", async ({ page, db: _db }) => {
    await page.goto("/run/ref-payments-workspace");
    await waitForRegions(page);
    await page.locator('[data-demo-anchor="pay-lumen"]').click();
    await expect(region(page, "transfer-form").getByRole("combobox", { name: "Payee" })).toHaveText("Lumen Energy");
  });

  test("updates KYC for a chosen client and service health for a chosen incident", async ({ page, db: _db }) => {
    await page.goto("/run/ref-client-onboarding");
    await waitForRegions(page);
    await region(page, "client-search").getByRole("button", { name: /Tessera Robotics/ }).click();
    await expect(region(page, "kyc-checklist").getByRole("heading", { name: "KYC · Tessera Robotics" })).toBeVisible();

    await page.goto("/run/ref-operations-console");
    await waitForRegions(page);
    await page.locator('[data-demo-anchor="focus-INC-2042"]').click();
    await expect(region(page, "service-health")).toContainText("Focused on Americas");
  });
});

test.describe("accessible templates", () => {
  for (const template of TEMPLATES) {
    test(`keeps every microfrontend version free of violations in light and dark (${template.slug}) (Every microfrontend version passes an accessibility audit)`, async ({ page, db: _db }) => {
      test.setTimeout(300_000);
      for (const member of template.app.members.filter((entry) => entry.role === "child")) {
        for (const version of member.versions) {
          const overrides = { [member.id]: { version: version.version, environment: "production" } };
          for (const route of template.app.routes.filter((entry) => entry.regions.some((placement) => placement.member === member.id))) {
            await page.goto(`/run/ref-${template.slug}/${route.path}`);
            await waitForRegions(page);
            for (const theme of ["light", "dark"] as const) {
              await setView(page, { theme, overrides });
              await expect(region(page, member.id)).toHaveAttribute("data-demo-version", version.version);
              expect(await audit(page), `${member.id}@${version.version} on /${route.path}, ${theme}`).toEqual([]);
            }
          }
        }
      }
    });
  }
});

test.describe("responsive interactions and roles", () => {
  for (const hero of HEROES) {
    test(`responds to ${hero.action} within 100 ms (${hero.slug}) (Interactions respond quickly)`, async ({ page, db: _db }) => {
      await page.goto(`/run/ref-${hero.slug}`);
      await waitForRegions(page);
      const elapsed = await page.getByRole("button", { name: hero.action }).evaluate((button: HTMLButtonElement) => {
        const started = performance.now();
        button.click();
        return performance.now() - started;
      });
      expect(elapsed).toBeLessThan(100);
    });
  }

  test("shows Approve actions only to a profile with the Approver persona", async ({ page, db: _db }) => {
    await page.goto("/run/ref-payments-workspace");
    await waitForRegions(page);
    await expect(region(page, "payment-activity").getByRole("button", { name: /^Approve/ })).toHaveCount(0);
    await setView(page, { profileId: "approver" });
    await expect(page.getByText("Sam Rivera")).toBeVisible();
    await expect(region(page, "payment-activity").getByRole("button", { name: "Approve PMT-3302" })).toBeVisible();
    await region(page, "payment-activity").getByRole("button", { name: "Approve PMT-3302" }).click();
    await expect(region(page, "payment-activity").getByText("Approved")).toBeVisible();
  });
});

test.describe("lighter templates", () => {
  test("render their own two Salt microfrontends in their brand's shell, the main one publishing its selection to the side one (Lighter template composition)", async ({ page, db: _db }) => {
    await page.goto("/run/ref-fx-rates-board");
    await waitForRegions(page);
    await expect(page.locator("[data-demo-portal]")).toHaveAttribute("data-brand", "markets");
    await expect(home(page, MARKETS)).toBeVisible();
    await expect(page.locator("[data-demo-mfe]")).toHaveCount(2);
    await expect(region(page, "fx-rates").getByRole("heading", { level: 2, name: "FX rates" })).toBeVisible();
    await expect(region(page, "rate-detail").getByRole("heading", { level: 2, name: "EUR/USD" })).toBeVisible();
    await region(page, "fx-rates").getByRole("button", { name: "GBP/USD" }).click();
    await expect(region(page, "fx-rates").getByRole("button", { name: "GBP/USD" })).toHaveAttribute("aria-pressed", "true");
    await expect(region(page, "rate-detail").getByRole("heading", { level: 2, name: "GBP/USD" })).toBeVisible();
  });

  for (const template of TEMPLATES.filter((entry) => !entry.hero)) {
    test(`opens each region with one level-2 heading and reflows at 375 pixels (${template.slug}) (Region rhythm)`, async ({ page, db: _db }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(`/run/ref-${template.slug}`);
      await waitForRegions(page);
      for (const member of template.app.members.filter((entry) => entry.role === "child")) await expect(region(page, member.id).getByRole("heading", { level: 2 }), member.id).toHaveCount(1);
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe("self-contained runtime", () => {
  test("makes no request to any other origin while every member is used", async ({ page, baseURL, db: _db }) => {
    test.setTimeout(180_000);
    const origin = new URL(baseURL!).origin;
    const outside: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).origin !== origin && !request.url().startsWith("data:")) outside.push(request.url());
    });
    for (const hero of HEROES) {
      const template = templateBySlug(hero.slug)!;
      for (const route of template.app.routes) {
        await page.goto(`/run/ref-${hero.slug}/${route.path}`);
        await waitForRegions(page);
        const buttons = page.locator("[data-demo-mfe] button:visible");
        // A Salt Dropdown or menu opens a popup over the page, so each click is closed with Escape and given a short wait.
        for (let index = 0; index < Math.min(await buttons.count(), 12); index++) {
          await buttons.nth(index).click({ timeout: 2_000 }).catch(() => {});
          await page.keyboard.press("Escape");
        }
        for (const input of await page.locator("[data-demo-mfe] input:visible").all()) await input.fill("12", { timeout: 2_000 }).catch(() => {});
      }
    }
    expect(outside).toEqual([]);
  });

  test("stays usable with a keyboard at 200 percent zoom", async ({ page, db: _db }) => {
    test.setTimeout(120_000);
    // A 640px-wide viewport is what a 1280px window shows at 200 percent zoom.
    await page.setViewportSize({ width: 640, height: 720 });
    for (const hero of HEROES) {
      await page.goto(`/run/ref-${hero.slug}`);
      await waitForRegions(page);
      await expectNoHorizontalOverflow(page);
      const reached = new Set<string>();
      for (let stop = 0; stop < 60; stop++) {
        await page.keyboard.press("Tab");
        const focused = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          if (!element || element === document.body) return null;
          const rect = element.getBoundingClientRect();
          return { member: element.closest("[data-demo-mfe]")?.getAttribute("data-demo-mfe") ?? null, visible: rect.width > 0 && rect.height > 0 };
        });
        if (focused?.member) {
          expect(focused.visible).toBe(true);
          reached.add(focused.member);
        }
      }
      // Every region with a control can be reached; a chart with nothing to operate has no focus stop.
      const interactive = await page.locator("[data-demo-mfe]").evaluateAll((regions) =>
        regions.filter((element) => element.querySelector('a[href], button, input, select, textarea, [tabindex="0"]')).map((element) => element.getAttribute("data-demo-mfe")!),
      );
      expect(interactive.length).toBeGreaterThanOrEqual(2);
      expect([...reached].sort(), hero.slug).toEqual(interactive.sort());
    }
  });
});
