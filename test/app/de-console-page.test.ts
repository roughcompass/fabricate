import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DeConsoleImportPage from "@/app/(operator)/repositories/de-console/page";
import { DE_CONSOLE_TOKEN, getConfig, setConfig, withOverrides } from "@/lib/config";
import { type Db, setDb } from "@/lib/db/client";
import { recordFailedDeConsoleRead } from "@/lib/ownership/de-console";
import { createApplication } from "@/lib/ownership/records";
import { createTestDb } from "../support/db";
import { readDeConsole } from "../support/home";

// page-patterns spec: the DE Console import page shows reads and open conflicts.

const original = getConfig();
const render = () => renderToStaticMarkup(createElement(DeConsoleImportPage));

describe("DE Console import page", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    setDb(db);
  });
  afterEach(() => {
    setDb(undefined);
    setConfig(original);
    delete process.env[DE_CONSOLE_TOKEN];
  });

  it("says the import isn't configured and raises no alert, but still lists conflicts left from earlier reads (No source configured)", () => {
    setConfig(withOverrides(original, { deConsole: { source: null } }));
    recordFailedDeConsoleRead(db, { trigger: "schedule", error: "The DE Console didn't answer", readAt: new Date() });
    expect(render()).toContain("Not configured");
    expect(render()).not.toContain("couldn't be read");
    expect(render()).toContain("No open conflicts");

    createApplication(db, { sealId: "88002", name: "Access Shell" });
    createApplication(db, { sealId: "88002", name: "Access Settings" });
    readDeConsole(db, [{ seal_id: "88002" }], new Date());
    expect(render()).toContain("Matches several applications");
  });

  it("never shows the endpoint's address or its token (Credentials stay hidden)", () => {
    process.env[DE_CONSOLE_TOKEN] = "t0ps3cret-token";
    setConfig(withOverrides(original, { deConsole: { source: "https://console.example.com/ownership/export" } }));
    recordFailedDeConsoleRead(db, { trigger: "schedule", error: "The DE Console answered 503", readAt: new Date() });

    const html = render();
    expect(html).toContain("Configured");
    expect(html).toContain("The DE Console answered 503");
    expect(html).not.toContain("console.example.com");
    expect(html).not.toContain("t0ps3cret");
  });

  it("raises one alert when the values are older than three refresh intervals", () => {
    setConfig(withOverrides(original, { deConsole: { source: "/tmp/de-console-export.json", refreshMinutes: 60 } }));
    readDeConsole(db, [{ seal_id: "88001" }], new Date(Date.now() - 4 * 3_600_000));

    const html = render();
    expect(html).toContain("DE Console values are out of date");
    expect(html).not.toContain("couldn't be read");
  });
});
