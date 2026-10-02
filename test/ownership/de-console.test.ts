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
  parseDeConsoleExport,
  readDeConsole,
  recordDeConsoleRead,
  refreshDeConsole,
} from "@/lib/ownership/de-console";
import { READ_DE_CONSOLE, scheduleDeConsoleReads } from "@/lib/ownership/de-console-schedule";
import { applicationOwnership } from "@/lib/ownership/read";
import { ensureApplication } from "@/lib/ownership/records";
import { createTestDb } from "../support/db";

const FIXTURE = path.resolve("test/fixtures/de-console/export-v1.json");
const at = (minute: number) => new Date(Date.UTC(2026, 9, 2, 8, minute));
const exportOf = (applications: object[]) => ({ format: "de-console-ownership", version: 1, exported_at: null, applications });
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
  const ownershipOf = (sealId: string) => applicationOwnership(db, [ensureApplication(db, sealId).id]).values().next().value!;

  describe("the export format", () => {
    it("reads the fixture export", async () => {
      expect(await readDeConsole({ kind: "file", path: FIXTURE })).toEqual({
        exportedAt: new Date("2026-10-02T06:00:00Z"),
        applications: [
          { sealId: "88001", name: "Access Shell", team: "Access Platform", portals: ["Access"] },
          { sealId: "88002", name: "FX Board", team: "FX Digital", portals: ["Markets", "Access"] },
          { sealId: "88003", name: "Payee Hub", team: null, portals: [] },
        ],
      });
    });

    it("keeps one of each portal and trims labels", () => {
      const parsed = parseDeConsoleExport(exportOf([{ seal_id: " 88001 ", portals: ["Access", " access ", "Digital  Bank"] }]));
      expect(parsed.applications).toEqual([{ sealId: "88001", name: null, team: null, portals: ["Access", "Digital Bank"] }]);
    });

    it.each([
      ["another format", { ...exportOf([]), format: "seal-registry" }, /format/],
      ["a later version", { ...exportOf([]), version: 2 }, /version/],
      ["an application without a SEAL ID", exportOf([{ name: "Nameless", portals: [] }]), /applications\.0\.seal_id/],
      ["a SEAL ID listed twice", exportOf([{ seal_id: "88001" }, { seal_id: "88001" }]), /88001 more than once/],
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
