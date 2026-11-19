import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db/client";

describe("openDatabase", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

  it("creates the database with WAL, foreign keys, and a busy timeout", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-registry-db-"));
    directories.push(dir);
    const db = openDatabase(path.join(dir, "nested", "frontend-registry.sqlite3"));

    expect(db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.$client.pragma("busy_timeout", { simple: true })).toBe(5000);
    db.$client.close();
  });
});
