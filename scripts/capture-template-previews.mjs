// Captures each template's preview image from its reference deployment into
// public/demo/previews/<slug>.jpg, so gallery cards show the real application.
//
//   npx tsx scripts/capture-template-previews.mjs [base URL]
//
// Run it against a server with the template demo enabled, such as
// `npm run dev:web` (the default base URL is http://localhost:3000). Commit
// the images it writes: cards then render identically everywhere.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { TEMPLATES } from "../src/lib/demo/catalog/templates.ts";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const output = path.resolve("public/demo/previews");
fs.mkdirSync(output, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
try {
  for (const template of TEMPLATES) {
    // Embedded, as preview mode frames it: the application without the demo toolbar.
    await page.goto(`${base}/run/ref-${template.slug}?embed=1`, { waitUntil: "networkidle" });
    // Wait for every microfrontend's scripted load, and hide the development server's indicator.
    await page.locator("[data-demo-mfe]").first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll("[data-demo-mfe]")].every((region) => region.getAttribute("data-demo-state") === "ready"), null, { timeout: 15_000 });
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    const file = path.join(output, `${template.slug}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 80 });
    console.log(`Captured ${path.relative(process.cwd(), file)}`);
  }
} finally {
  await browser.close();
}
