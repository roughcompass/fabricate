import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DE_CONSOLE_TOKEN, type FabricateConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { jobs, ownershipAssertions } from "@/lib/db/schema";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import {
  DeConsoleReadError,
  MAX_EXPORT_BYTES,
  deConsoleApplications,
  deConsoleStatus,
  openDeConsoleConflicts,
  parseDeConsoleExport,
  readDeConsole,
  recordDeConsoleRead,
  refreshDeConsole,
  resolveDeConsoleConflict,
} from "@/lib/ownership/de-console";
import { READ_DE_CONSOLE, scheduleDeConsoleReads } from "@/lib/ownership/de-console-schedule";
import { applicationOwnership } from "@/lib/ownership/read";
import { applicationsWithSealId, createApplication } from "@/lib/ownership/records";
import { createTestDb, rawRun } from "../support/db";

const FIXTURE = path.resolve("test/fixtures/de-console/export-v1.json");
const at = (minute: number) => new Date(Date.UTC(2026, 9, 2, 8, minute));
const exportOf = (applications: object[]) => ({ format: "de-console-ownership", version: 1, exported_at: null, applications });
const exportV2 = (applications: object[]) => ({ format: "de-console-ownership", version: 2, exported_at: null, applications });
const configFor = (source: string | null, refreshMinutes = 60): FabricateConfig => withOverrides(getConfig(), { deConsole: { source, refreshMinutes } });

describe("DE Console import", () => {
  let db: Db;
  let scratch: string;

  beforeEach(() => {
    db = createTestDb();
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fabricate-de-console-"));
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  const writeExport = (applications: object[]) => {
    const file = path.join(scratch, "export.json");
    fs.writeFileSync(file, JSON.stringify(exportOf(applications)));
    return file;
  };
  /** The ownership of the one application carrying +sealId+. */
  const ownershipOf = (sealId: string) => {
    const [application, ...others] = applicationsWithSealId(db, sealId);
    expect(others).toEqual([]);
    return applicationOwnership(db, [application!.id]).values().next().value!;
  };
  const read = (document: object, minute: number) => recordDeConsoleRead(db, parseDeConsoleExport(document), { trigger: "schedule", readAt: at(minute) });

  describe("the export format", () => {
    it("reads the fixture export", async () => {
      expect(await readDeConsole({ kind: "file", path: FIXTURE })).toEqual({
        version: 1,
        exportedAt: new Date("2026-10-02T06:00:00Z"),
        applications: [
          { consoleId: null, sealId: "88001", name: "Access Shell", team: "Access Platform", portals: ["Access"] },
          { consoleId: null, sealId: "88002", name: "FX Board", team: "FX Digital", portals: ["Markets", "Access"] },
          { consoleId: null, sealId: "88003", name: "Payee Hub", team: null, portals: [] },
        ],
      });
    });

    it("reads a version 2 export, whose stable application IDs may share a SEAL ID or have none", async () => {
      expect(await readDeConsole({ kind: "file", path: path.resolve("test/fixtures/de-console/export-v2.json") })).toEqual({
        version: 2,
        exportedAt: new Date("2026-10-03T06:00:00Z"),
        applications: [
          { consoleId: "app-1001", sealId: "88001", name: "Access Shell", team: "Access Platform", portals: ["Access"] },
          { consoleId: "app-1002", sealId: "88001", name: "Access Settings", team: "Access Platform", portals: ["Access"] },
          { consoleId: "app-2001", sealId: null, name: "Payee Hub", team: "Payee Services", portals: [] },
        ],
      });
    });

    it("keeps one of each portal and trims labels", () => {
      const parsed = parseDeConsoleExport(exportOf([{ seal_id: " 88001 ", portals: ["Access", " access ", "Digital  Bank"] }]));
      expect(parsed.applications).toEqual([{ consoleId: null, sealId: "88001", name: null, team: null, portals: ["Access", "Digital Bank"] }]);
    });

    it.each([
      ["another format", { ...exportOf([]), format: "seal-registry" }, /format/],
      ["a later version", { ...exportOf([]), version: 3 }, /version/],
      ["a legacy application without a SEAL ID", exportOf([{ name: "Nameless", portals: [] }]), /applications\.0\.seal_id/],
      ["a version 2 application without its ID", exportV2([{ seal_id: "88001" }]), /applications\.0\.application_id/],
      ["an application ID listed twice", exportV2([{ application_id: "app-1", seal_id: "88001" }, { application_id: "app-1", seal_id: "88002" }]), /application ID app-1 more than once/],
    ])("refuses %s as a whole", (_label, document, message) => {
      expect(() => parseDeConsoleExport(document)).toThrow(DeConsoleReadError);
      expect(() => parseDeConsoleExport(document)).toThrow(message);
    });

    it("refuses a file that isn't JSON, is missing, or is too large", async () => {
      const broken = path.join(scratch, "broken.json");
      fs.writeFileSync(broken, "{ not json");
      await expect(readDeConsole({ kind: "file", path: broken })).rejects.toThrow("The export isn't valid JSON");
      await expect(readDeConsole({ kind: "file", path: path.join(scratch, "missing.json") })).rejects.toThrow(/couldn't be read \(ENOENT\)/);
      const large = path.join(scratch, "large.json");
      fs.writeFileSync(large, Buffer.alloc(MAX_EXPORT_BYTES + 1, " "));
      await expect(readDeConsole({ kind: "file", path: large })).rejects.toThrow(/larger than/);
    });
  });

  describe("recording a read", () => {
    it("records each value as a DE Console assertion with the time it was read", async () => {
      const read = recordDeConsoleRead(db, await readDeConsole({ kind: "file", path: FIXTURE }), { trigger: "schedule", readAt: at(0) });

      expect(read).toMatchObject({ status: "succeeded", applications: 3, recorded: 5, exportedAt: new Date("2026-10-02T06:00:00Z") });
      const fx = ownershipOf("88002");
      expect(fx.deWeb).toBe(true);
      expect(fx.team).toMatchObject({ value: "FX Digital", provenance: { source: "de_console", verification: "not_required", readAt: at(0) } });
      expect(fx.portals.map((item) => [item.portal.label, item.flagged]).sort()).toEqual([
        ["Access", false],
        ["Markets", false],
      ]);
      expect(deConsoleApplications(db).map((application) => [application.sealId, application.name])).toEqual([
        ["88001", "Access Shell"],
        ["88002", "FX Board"],
      ]);
      expect(db.$client.prepare("select console_key, basis from de_console_links order by id").all()).toEqual([
        { console_key: "seal:88001", basis: "created" },
        { console_key: "seal:88002", basis: "created" },
        { console_key: "seal:88003", basis: "created" },
      ]);
    });

    it("supersedes the earlier team when it changes, and the history keeps both (Team changes in the DE Console)", () => {
      recordDeConsoleRead(db, parseDeConsoleExport(exportOf([{ seal_id: "88001", team: "Access Platform" }])), { trigger: "schedule", readAt: at(0) });
      const changed = recordDeConsoleRead(db, parseDeConsoleExport(exportOf([{ seal_id: "88001", team: "Access Experience" }])), { trigger: "schedule", readAt: at(30) });

      expect(changed.recorded).toBe(1);
      expect(ownershipOf("88001").team).toMatchObject({ value: "Access Experience", conflict: false, provenance: { readAt: at(30) } });
      const history = db.select().from(ownershipAssertions).all().filter((assertion) => assertion.attribute === "team");
      expect(history.map((assertion) => [assertion.valueTeam, assertion.readAt])).toEqual([
        ["Access Platform", at(0)],
        ["Access Experience", at(30)],
      ]);
      const supersession = db.$client.prepare("select assertion_id, superseded_id from ownership_supersessions").all();
      expect(supersession).toEqual([{ assertion_id: history[1]!.id, superseded_id: history[0]!.id }]);
    });

    it("records nothing for an unchanged read, but logs it", () => {
      const document = parseDeConsoleExport(exportOf([{ seal_id: "88001", team: "Access Platform", portals: ["Access"] }]));
      recordDeConsoleRead(db, document, { trigger: "schedule", readAt: at(0) });
      const again = recordDeConsoleRead(db, document, { trigger: "claim", readAt: at(5) });

      expect(again).toMatchObject({ status: "succeeded", recorded: 0, trigger: "claim" });
      expect(db.select().from(ownershipAssertions).all()).toHaveLength(2);
      expect(deConsoleStatus(db).lastSuccess?.readAt).toEqual(at(5));
    });

    it("removes a portal the DE Console stops listing", () => {
      recordDeConsoleRead(db, parseDeConsoleExport(exportOf([{ seal_id: "88002", portals: ["Markets", "Access"] }])), { trigger: "schedule", readAt: at(0) });
      const read = recordDeConsoleRead(db, parseDeConsoleExport(exportOf([{ seal_id: "88002", portals: ["Markets"] }])), { trigger: "schedule", readAt: at(30) });
      expect(read.recorded).toBe(1);
      expect(ownershipOf("88002").portals.map((item) => item.portal.label)).toEqual(["Markets"]);

      recordDeConsoleRead(db, parseDeConsoleExport(exportOf([{ seal_id: "88002", portals: ["Markets", "Access"] }])), { trigger: "schedule", readAt: at(45) });
      expect(ownershipOf("88002").portals.map((item) => item.portal.label).sort()).toEqual(["Access", "Markets"]);
    });
  });

  describe("which application an entry describes", () => {
    it("keeps version 2 applications that share a SEAL ID apart, and follows each by its stable ID", () => {
      read(exportV2([{ application_id: "app-1001", seal_id: "88001", name: "Access Shell", team: "Access Platform" }, { application_id: "app-1002", seal_id: "88001", name: "Access Settings", team: "Access Settings Team" }]), 0);
      const [shell, settings] = applicationsWithSealId(db, "88001");
      expect([shell!.name, settings!.name]).toEqual(["Access Shell", "Access Settings"]);

      // The DE Console corrects one SEAL ID: the same application carries the new one.
      read(exportV2([{ application_id: "app-1001", seal_id: "88009", name: "Access Shell", team: "Access Platform" }, { application_id: "app-1002", seal_id: "88001", name: "Access Settings", team: "Access Settings Team" }]), 30);
      expect(applicationsWithSealId(db, "88009").map((application) => application.id)).toEqual([shell!.id]);
      expect(applicationOwnership(db, [shell!.id, settings!.id]).get(settings!.id)!.team.value).toBe("Access Settings Team");
      expect(db.$client.prepare("select count(*) as n from applications").get()).toEqual({ n: 2 });
    });

    it("carries a legacy entry's application over to its stable ID", () => {
      read(exportOf([{ seal_id: "88001", team: "Access Platform" }]), 0);
      const [legacy] = applicationsWithSealId(db, "88001");

      read(exportV2([{ application_id: "app-1001", seal_id: "88001", team: "Access Platform" }]), 30);

      expect(applicationsWithSealId(db, "88001").map((application) => application.id)).toEqual([legacy!.id]);
      expect(db.$client.prepare("select console_key, application_id, basis from de_console_links order by id").all()).toEqual([
        { console_key: "seal:88001", application_id: legacy!.id, basis: "created" },
        { console_key: "id:app-1001", application_id: legacy!.id, basis: "matched" },
      ]);
    });

    it("links a legacy entry to the only application carrying its SEAL ID, and later ones carrying it stay apart", () => {
      const claimed = createApplication(db, { sealId: "88001", name: "Access Shell" });
      read(exportOf([{ seal_id: "88001", team: "Access Platform" }]), 0);
      const later = createApplication(db, { sealId: "88001", name: "Access Settings" });

      read(exportOf([{ seal_id: "88001", team: "Access Experience" }]), 30);

      const owned = applicationOwnership(db, [claimed.id, later.id]);
      expect(owned.get(claimed.id)!.team).toMatchObject({ value: "Access Experience", provenance: { source: "de_console" } });
      expect(owned.get(later.id)!.team.value).toBeNull();
      expect(openDeConsoleConflicts(db)).toEqual([]);
    });

    it("records a legacy SEAL ID several applications carry as a conflict, records none of its values, and merges nothing", () => {
      const shell = createApplication(db, { sealId: "88001", name: "Access Shell" });
      const settings = createApplication(db, { sealId: "88001", name: "Access Settings" });

      const first = read(exportOf([{ seal_id: "88001", team: "Access Platform" }, { seal_id: "88002", team: "FX Digital" }]), 0);
      read(exportOf([{ seal_id: "88001", team: "Access Platform" }, { seal_id: "88002", team: "FX Digital" }]), 30);

      expect(first).toMatchObject({ applications: 2, recorded: 1 });
      const [conflict, ...others] = openDeConsoleConflicts(db);
      expect(others).toEqual([]);
      expect(conflict).toMatchObject({ consoleKey: "seal:88001", reason: "several_applications", readId: first.id, candidates: JSON.stringify([shell.publicId, settings.publicId]) });
      expect(db.$client.prepare("select count(*) as n from de_console_conflicts").get()).toEqual({ n: 1 });
      expect(applicationOwnership(db, [shell.id]).get(shell.id)!.team.value).toBeNull();
      expect(db.$client.prepare("select count(*) as n from applications where seal_id = '88001'").get()).toEqual({ n: 2 });

      expect(() => resolveDeConsoleConflict(db, conflict!.publicId, { application: settings.publicId, resolvedBy: " " })).toThrow(/your name/);
      expect(() => resolveDeConsoleConflict(db, conflict!.publicId, { application: "wap_aaaaaaaaaaaaaaaa", resolvedBy: "ana" })).toThrow(/Choose one of the applications/);
      resolveDeConsoleConflict(db, conflict!.publicId, { application: settings.publicId, resolvedBy: "ana@example.com" });
      expect(() => resolveDeConsoleConflict(db, conflict!.publicId, { application: shell.publicId, resolvedBy: "ana@example.com" })).toThrow(/already linked/);
      read(exportOf([{ seal_id: "88001", team: "Access Platform" }]), 45);

      expect(openDeConsoleConflicts(db)).toEqual([]);
      expect(applicationOwnership(db, [settings.id]).get(settings.id)!.team).toMatchObject({ value: "Access Platform", provenance: { source: "de_console" } });
      expect(applicationOwnership(db, [shell.id]).get(shell.id)!.team.value).toBeNull();
      expect(db.$client.prepare("select basis, linked_by from de_console_links where console_key = 'seal:88001'").get()).toEqual({ basis: "resolved", linked_by: "ana@example.com" });
    });

    it("records a SEAL ID a legacy export lists twice as a conflict that no choice settles", () => {
      const result = read(exportOf([{ seal_id: "88001", name: "Access Shell", team: "Access Platform" }, { seal_id: "88001", name: "Access Settings", team: "Access Settings Team" }, { seal_id: "88002" }]), 0);

      expect(result).toMatchObject({ status: "succeeded", applications: 3 });
      expect(applicationsWithSealId(db, "88001")).toEqual([]);
      const conflicts = openDeConsoleConflicts(db);
      expect(conflicts.map((conflict) => [conflict.consoleKey, conflict.reason, conflict.name]).sort()).toEqual([
        ["seal:88001", "duplicate_in_export", "Access Settings"],
      ]);
      expect(() => resolveDeConsoleConflict(db, conflicts[0]!.publicId, { application: null, resolvedBy: "ana" })).toThrow(/more than once/);
      read(exportOf([{ seal_id: "88001", name: "Access Shell", team: "Access Platform" }, { seal_id: "88001", name: "Access Settings", team: "Access Settings Team" }]), 30);
      expect(db.$client.prepare("select count(*) as n from de_console_conflicts").get()).toEqual({ n: 2 });
    });

    it("keeps links and conflicts as recorded", () => {
      read(exportOf([{ seal_id: "88001" }, { seal_id: "88001" }, { seal_id: "88002" }]), 0);
      expect(() => rawRun(db, "update de_console_links set console_key = 'seal:9'")).toThrow(/never changed/);
      expect(() => rawRun(db, "delete from de_console_links")).toThrow(/retained/);
      expect(() => rawRun(db, "update de_console_conflicts set name = 'x'")).toThrow(/never changed/);
      expect(() => rawRun(db, "delete from de_console_conflicts")).toThrow(/retained/);
      const application = applicationsWithSealId(db, "88002")[0]!;
      expect(() => rawRun(db, "insert into de_console_links (console_key, application_id, basis, linked_at) values ('id:a', ?, 'resolved', 1)", application.id)).toThrow(/de_console_links_linked_by/);
      rawRun(db, "insert into de_console_links (console_key, application_id, basis, linked_at) values ('id:a', ?, 'matched', 1)", application.id);
      expect(() => rawRun(db, "insert into de_console_links (console_key, application_id, basis, linked_at) values ('id:b', ?, 'matched', 1)", application.id)).toThrow(/UNIQUE/);
      expect(() => rawRun(db, "insert into de_console_links (console_key, application_id, basis, linked_at) values ('88003', ?, 'matched', 1)", application.id)).toThrow(/de_console_links_key/);
    });
  });

  describe("reading when it's needed", () => {
    it("keeps the last successful read's values when the DE Console can't be read (DE Console unavailable)", async () => {
      const file = writeExport([{ seal_id: "88001", team: "Access Platform" }]);
      expect((await refreshDeConsole(db, configFor(file), "schedule")).status).toBe("succeeded");
      const succeeded = deConsoleStatus(db).lastSuccess!;
      fs.rmSync(file);

      const failed = await refreshDeConsole(db, configFor(file), "claim");

      expect(failed).toMatchObject({ status: "failed", read: { trigger: "claim", error: "The export file couldn't be read (ENOENT)" } });
      expect(deConsoleStatus(db)).toMatchObject({ lastSuccess: { id: succeeded.id }, lastAttempt: { status: "failed" } });
      expect(ownershipOf("88001").team).toMatchObject({ value: "Access Platform", provenance: { readAt: succeeded.readAt } });
    });

    it("does nothing when no source is configured", async () => {
      expect(await refreshDeConsole(db, configFor(null), "claim")).toEqual({ status: "not_configured" });
      expect(scheduleDeConsoleReads(db, configFor(null))).toEqual([]);
      expect(deConsoleStatus(db)).toEqual({ lastSuccess: null, lastAttempt: null });
    });

    it("reads on a schedule through the job worker, once per slot, and queues the next slot", async () => {
      const config = configFor(writeExport([{ seal_id: "88001", team: "Access Platform" }]), 15);
      const now = new Date(Date.UTC(2026, 9, 2, 8, 7));
      vi.useFakeTimers({ toFake: ["Date"], now });

      const queued = scheduleDeConsoleReads(db, config, now);
      expect(scheduleDeConsoleReads(db, config, now).map((job) => job.id)).toEqual(queued.map((job) => job.id));
      expect(queued.map((job) => [job.kind, job.idempotencyKey, job.runAfter])).toEqual([
        [READ_DE_CONSOLE, `${READ_DE_CONSOLE}:2026-10-02T08:00:00.000Z`, now],
        [READ_DE_CONSOLE, `${READ_DE_CONSOLE}:2026-10-02T08:15:00.000Z`, new Date(Date.UTC(2026, 9, 2, 8, 15))],
      ]);

      const processed = await drainJobs(db, jobHandlers(db, config));

      expect(processed.map((job) => job.idempotencyKey)).toEqual([`${READ_DE_CONSOLE}:2026-10-02T08:00:00.000Z`]);
      expect(deConsoleStatus(db).lastSuccess).toMatchObject({ trigger: "schedule", applications: 1, recorded: 1 });
      expect(db.select().from(jobs).all().map((job) => [job.idempotencyKey, job.state])).toEqual([
        [`${READ_DE_CONSOLE}:2026-10-02T08:00:00.000Z`, "succeeded"],
        [`${READ_DE_CONSOLE}:2026-10-02T08:15:00.000Z`, "queued"],
      ]);
    });

    it("fails a scheduled read that can't reach the DE Console, and still queues the next one", async () => {
      const config = configFor(path.join(scratch, "missing.json"), 15);
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(Date.UTC(2026, 9, 2, 8, 7)) });
      scheduleDeConsoleReads(db, config);

      await drainJobs(db, jobHandlers(db, config));

      expect(db.select().from(jobs).all().map((job) => [job.state, job.lastError])).toEqual([
        ["failed", "NonRetryableError: The export file couldn't be read (ENOENT)"],
        ["queued", null],
      ]);
      expect(deConsoleStatus(db).lastAttempt).toMatchObject({ status: "failed", trigger: "schedule" });
    });
  });

  describe("the service identity", () => {
    const TOKEN = "de-console-service-token-7f3a";
    let server: http.Server;
    let requests: { method: string; url: string; authorization?: string }[];
    let respond: (request: http.IncomingMessage, response: http.ServerResponse) => void;
    let base: string;

    beforeEach(async () => {
      requests = [];
      respond = (_request, response) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(exportOf([{ seal_id: "88001", team: "Access Platform", portals: ["Access"] }])));
      server = http.createServer((request, response) => {
        requests.push({ method: request.method!, url: request.url!, authorization: request.headers.authorization });
        respond(request, response);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      vi.stubEnv(DE_CONSOLE_TOKEN, TOKEN);
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      await new Promise((resolve) => server.close(resolve));
    });

    it("only ever sends GET requests, with the service identity's token, on every path that reads", async () => {
      const config = configFor(`${base}/ownership/export`, 15);
      await refreshDeConsole(db, config, "claim");
      scheduleDeConsoleReads(db, config);
      await drainJobs(db, jobHandlers(db, config));
      respond = (_request, response) => response.writeHead(503).end(`unavailable for ${TOKEN}`);
      await refreshDeConsole(db, config, "claim");

      expect(requests.length).toBe(3);
      expect(requests.every((request) => request.method === "GET" && request.url === "/ownership/export" && request.authorization === `Bearer ${TOKEN}`)).toBe(true);
      expect(deConsoleStatus(db).lastAttempt).toMatchObject({ status: "failed", error: "The DE Console answered HTTP 503" });
    });

    it("refuses to follow a redirect, so the token goes nowhere else", async () => {
      respond = (request, response) => (request.url === "/elsewhere" ? response.writeHead(200).end("{}") : response.writeHead(302, { location: `${base}/elsewhere` }).end());

      const result = await refreshDeConsole(db, configFor(`${base}/export`), "claim");

      expect(result).toMatchObject({ status: "failed", read: { error: "The DE Console answered with a redirect, which isn't followed" } });
      expect(requests.map((request) => request.url)).toEqual(["/export"]);
    });

    it("gives up on a DE Console that doesn't answer in time", async () => {
      respond = () => undefined;

      await expect(readDeConsole({ kind: "url", url: `${base}/slow` }, { timeoutMs: 100 })).rejects.toThrow("The DE Console didn't answer in time");
      expect(requests.map((request) => [request.method, request.url])).toEqual([["GET", "/slow"]]);
    });

    it("stores the token in no table", async () => {
      const config = configFor(`${base}/export`);
      await refreshDeConsole(db, config, "claim");
      respond = (_request, response) => response.writeHead(500).end(TOKEN);
      await refreshDeConsole(db, config, "claim");

      const tables = db.$client.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[];
      for (const { name } of tables) expect(JSON.stringify(db.$client.prepare(`select * from "${name}"`).all()), name).not.toContain(TOKEN);
    });
  });
});
