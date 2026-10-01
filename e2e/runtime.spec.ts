import type { Page } from "@playwright/test";
import { templateBySlug } from "../src/lib/demo/catalog";
import { type AuditViolation, audit, setView, waitForRegions } from "./support/demo";
import { expect, expectNoHorizontalOverflow, test } from "./support/fixtures";

/** Running demo applications: portal shells, microfrontends, and planted findings (portal-runtime spec). */

const ACCESS = "J.P. Morgan Access";
const MARKETS = "J.P. Morgan Markets";

const HEROES = [
  { slug: "payments-workspace", shell: "access", portal: ACCESS, planted: "payee-list", fixed: "2.0.0", slow: "Recalculate totals" },
  { slug: "client-onboarding", shell: "access", portal: ACCESS, planted: "kyc-checklist", fixed: "3.3.0", slow: "Verify all documents" },
  { slug: "market-watch", shell: "markets", portal: MARKETS, planted: "watchlist", fixed: "1.9.0", slow: "Recalculate exposure" },
  { slug: "operations-console", shell: "access", portal: ACCESS, planted: "incident-feed", fixed: "6.1.0", slow: "Check for conflicts" },
] as const;

/** Whether an element lies entirely inside the viewport horizontally. */
async function fullyVisible(page: Page, locator: ReturnType<Page["locator"]>): Promise<boolean> {
  const box = await locator.boundingBox();
  const width = page.viewportSize()!.width;
  return Boolean(box && box.width > 0 && box.x >= 0 && box.x + box.width <= width);
}

const region = (page: Page, member: string) => page.locator(`[data-demo-mfe="${member}"]`);
const ruleIds = (violations: AuditViolation[]) => violations.map((violation) => violation.id).sort();

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
      // A plain-text wordmark: no logo images.
      await expect(page.getByRole("link", { name: `${hero.portal} home` })).toBeVisible();
      await expect(page.getByRole("link", { name: `${hero.portal} home` }).locator("img, svg")).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
      const navigation = page.getByRole("navigation", { name: `${hero.portal} navigation` });
      for (const route of template.app.routes) await expect(navigation.getByRole("link", { name: route.label })).toBeVisible();
      await expect(navigation.getByRole("link", { name: template.app.routes[0]!.label })).toHaveAttribute("aria-current", "page");
      const user = page.getByRole("button", { name: /Jordan Lee/ });
      await expect(user).toContainText("Analyst · London");
      await user.click();
      await expect(page.getByRole("region", { name: "User menu for Jordan Lee" })).toContainText("Analyst · London");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("region", { name: "User menu for Jordan Lee" })).toHaveCount(0);
      await expect(user).toBeFocused();
      await expect(page.getByRole("contentinfo")).toContainText(`An illustrative ${hero.portal} shell for the template demo.`);
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
    // The current route is tinted and bordered.
    const [tint, border] = await activity.evaluate((element) => [getComputedStyle(element).backgroundColor, getComputedStyle(element).borderLeftColor]);
    expect(tint).not.toBe("rgba(0, 0, 0, 0)");
    expect(border).not.toBe("rgba(0, 0, 0, 0)");
    await expect(navigation.getByRole("link", { name: "Home" })).toBeVisible();
    for (const group of ["Reports and Insights", "Support Hub"]) await expect(navigation.getByRole("button", { name: group })).toHaveAttribute("aria-expanded", "false");
    await navigation.getByRole("button", { name: "Reports and Insights" }).click();
    await expect(navigation.getByText("Statements")).toBeVisible();

    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem");
    await expect(crumbs).toHaveText(["Payments", "Payments workspace", "Activity"]);
    await expect(crumbs.last()).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  });

  for (const width of [1280, 375]) {
    test(`keeps the Access header actions and user menu fully visible at ${width}px`, async ({ page, db: _db }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/run/ref-client-onboarding");
      await waitForRegions(page);
      for (const name of ["Search", "Notifications", "Help"]) expect(await fullyVisible(page, page.getByRole("button", { name, exact: true })), name).toBe(true);
      expect(await fullyVisible(page, page.getByRole("button", { name: /Jordan Lee/ }))).toBe(true);
      expect(await fullyVisible(page, page.getByRole("link", { name: `${ACCESS} home` }))).toBe(true);
      await expectNoHorizontalOverflow(page);
    });
  }

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
    await expect(navigation.getByRole("link", { name: "Home" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(navigation).toBeHidden();
    await expect(menu).toBeFocused();
    await menu.click();
    await navigation.getByRole("link", { name: "Activity" }).click();
    await expect(page).toHaveURL(/\/activity$/);
    await expect(navigation).toBeHidden();
  });

  test("navigates the Markets shell's route tabs, underlining the current one under a serif title band", async ({ page, db: _db }) => {
    await page.goto("/run/ref-market-watch");
    await waitForRegions(page);
    await expect(page.getByRole("navigation", { name: `${MARKETS} sections` }).getByRole("link", { name: "Market watch" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Switch applications" })).toBeVisible();
    const tabs = page.getByRole("navigation", { name: `${MARKETS} navigation` });
    await tabs.getByRole("link", { name: "Blotter" }).click();
    await expect(page).toHaveURL(/\/run\/ref-market-watch\/blotter$/);
    const blotter = tabs.getByRole("link", { name: "Blotter" });
    await expect(blotter).toHaveAttribute("aria-current", "page");
    // Polled: under reduced motion the underline still takes one near-zero transition frame.
    await expect.poll(() => blotter.evaluate((element) => getComputedStyle(element).borderBottomColor)).not.toBe("rgba(0, 0, 0, 0)");
    await expect.poll(() => tabs.getByRole("link", { name: "Watch" }).evaluate((element) => getComputedStyle(element).borderBottomColor)).toBe("rgba(0, 0, 0, 0)");
    const title = page.getByRole("heading", { level: 1, name: "Blotter" });
    await expect(title).toBeVisible();
    expect(await title.evaluate((element) => getComputedStyle(element).fontFamily)).toMatch(/serif/);
    const footer = page.getByRole("contentinfo");
    await expect(footer).toContainText("J.P.Morgan");
    for (const link of ["Terms of Use", "Disclosures", "Security", "Privacy", "Cookies Policy", "Contact Us"]) await expect(footer.getByRole("link", { name: link })).toBeVisible();
  });

  test("uses near-black bars and a deep blue title band in the dark Markets theme", async ({ page, db: _db }) => {
    await page.goto("/run/ref-market-watch");
    await waitForRegions(page);
    await setView(page, { theme: "dark" });
    const rgb = (value: string) => value.match(/\d+/g)!.slice(0, 3).map(Number);
    const bar = rgb(await page.locator('[data-demo-anchor="portal-header"]').evaluate((element) => getComputedStyle(element).backgroundColor));
    expect(Math.max(...bar)).toBeLessThan(24);
    const band = rgb(await page.getByRole("heading", { level: 1 }).evaluate((element) => getComputedStyle(element.parentElement!.parentElement!).backgroundColor));
    expect(band[2]).toBeGreaterThan(band[0]! + 40);
    expect(Math.max(...band)).toBeLessThan(128);
  });

  for (const hero of [HEROES[0], HEROES[2]]) {
    test(`keeps the ${hero.portal} header menus free of violations while they are open`, async ({ page, db: _db }) => {
      await page.goto(`/run/ref-${hero.slug}`);
      await waitForRegions(page);
      await setView(page, { overrides: { [hero.planted]: { version: hero.fixed, environment: "production" } } });
      const menus = ["Search", "Notifications", "Help", ...(hero.shell === "markets" ? ["Switch applications"] : [])];
      for (const name of [...menus, "User menu for Jordan Lee"]) {
        const control = name.startsWith("User menu") ? page.getByRole("button", { name: /Jordan Lee/ }) : page.getByRole("button", { name, exact: true });
        await control.click();
        const menu = page.locator("[data-demo-portal]").getByRole("region", { name });
        await expect(menu).toBeVisible();
        expect(await audit(page), name).toEqual([]);
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
      await expect(page.getByRole("link", { name: `${ACCESS} home` })).toBeVisible();
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
    await expect(region(page, "transfer-form").getByLabel("Payee")).toHaveValue("lumen");
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

test.describe("planted accessibility defects", () => {
  for (const hero of HEROES) {
    test(`finds the planted defects in ${hero.planted} and none once it is fixed (${hero.slug})`, async ({ page, db: _db }) => {
      await page.goto(`/run/ref-${hero.slug}`);
      await waitForRegions(page);
      const planted = await audit(page);
      expect(ruleIds(planted)).toEqual(["button-name", "color-contrast", "label"]);
      for (const violation of planted) expect(violation.members, violation.id).toEqual([hero.planted]);

      for (const theme of ["light", "dark"] as const) {
        await setView(page, { theme, overrides: { [hero.planted]: { version: hero.fixed, environment: "production" } } });
        await expect(region(page, hero.planted)).toHaveAttribute("data-demo-version", hero.fixed);
        expect(await audit(page), `${hero.slug} ${theme}`).toEqual([]);
      }
    });
  }

  test("keeps every other version of the heroes free of violations", async ({ page, db: _db }) => {
    test.setTimeout(300_000);
    for (const hero of HEROES) {
      const template = templateBySlug(hero.slug)!;
      await page.goto(`/run/ref-${hero.slug}`);
      await waitForRegions(page);
      for (const member of template.app.members.filter((entry) => entry.role === "child")) {
        for (const version of member.versions.filter((entry) => !entry.planted?.length)) {
          const overrides = { [member.id]: { version: version.version, environment: "production" }, ...(member.id === hero.planted ? {} : { [hero.planted]: { version: hero.fixed, environment: "production" } }) };
          for (const route of template.app.routes.filter((entry) => entry.regions.some((placement) => placement.member === member.id))) {
            await page.goto(`/run/ref-${hero.slug}/${route.path}`);
            await setView(page, { overrides });
            expect(await audit(page), `${member.id}@${version.version} on /${route.path}`).toEqual([]);
          }
        }
      }
    }
  });
});

test.describe("slow microfrontends and roles", () => {
  for (const hero of HEROES) {
    test(`blocks the page for at least 600 ms on ${hero.slow} (${hero.slug})`, async ({ page, db: _db }) => {
      await page.goto(`/run/ref-${hero.slug}`);
      await waitForRegions(page);
      const elapsed = await page.getByRole("button", { name: hero.slow }).evaluate((button: HTMLButtonElement) => {
        const started = performance.now();
        button.click();
        return performance.now() - started;
      });
      expect(elapsed).toBeGreaterThanOrEqual(600);
    });
  }

  test("shows Approve actions only to the Approver role", async ({ page, db: _db }) => {
    await page.goto("/run/ref-payments-workspace");
    await waitForRegions(page);
    await expect(region(page, "payment-activity").getByRole("button", { name: /^Approve/ })).toHaveCount(0);
    await setView(page, { personaId: "approver" });
    await expect(page.getByText("Sam Rivera")).toBeVisible();
    await expect(region(page, "payment-activity").getByRole("button", { name: "Approve PMT-3302" })).toBeVisible();
    await region(page, "payment-activity").getByRole("button", { name: "Approve PMT-3302" }).click();
    await expect(region(page, "payment-activity").getByText("Approved")).toBeVisible();
  });
});

test.describe("lighter templates", () => {
  test("render the shared generic application in their brand's shell with two members", async ({ page, db: _db }) => {
    await page.goto("/run/ref-corporate-card-controls");
    await waitForRegions(page);
    await expect(page.locator("[data-demo-portal]")).toHaveAttribute("data-brand", "payments");
    await expect(page.getByRole("link", { name: `${ACCESS} home` })).toBeVisible();
    await expect(page.locator("[data-demo-mfe]")).toHaveCount(2);
    await expect(region(page, "overview").getByRole("heading", { name: "Corporate card controls" })).toBeVisible();
    await region(page, "overview").getByRole("button").first().click();
    await expect(region(page, "activity")).toContainText("Opened");
    expect(await audit(page)).toEqual([]);
  });
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
        for (let index = 0; index < Math.min(await buttons.count(), 12); index++) await buttons.nth(index).click({ trial: false }).catch(() => {});
        for (const input of await page.locator("[data-demo-mfe] input:visible").all()) await input.fill("12");
      }
    }
    expect(outside).toEqual([]);
  });

  test("stays usable with a keyboard at 200 percent zoom once the planted defects are fixed", async ({ page, db: _db }) => {
    test.setTimeout(120_000);
    // A 640px-wide viewport is what a 1280px window shows at 200 percent zoom.
    await page.setViewportSize({ width: 640, height: 720 });
    for (const hero of HEROES) {
      await page.goto(`/run/ref-${hero.slug}`);
      await waitForRegions(page);
      await setView(page, { overrides: { [hero.planted]: { version: hero.fixed, environment: "production" } } });
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
