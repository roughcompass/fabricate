import { execFileSync } from "node:child_process";
import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { vi } from "vitest";

/**
 * A `git` wrapper placed first on PATH that logs each invocation's argv and
 * then runs the real Git, so a test can inspect every Git command Fabricate
 * makes, including those of the job handlers' own runners.
 */
export class GitLog {
  private readonly log: string;
  private readonly bin: string;
  private readonly originalPath = process.env.PATH;

  constructor(directory: string) {
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    this.bin = path.join(directory, "bin");
    this.log = path.join(directory, "git.log");
    fs.mkdirSync(this.bin, { recursive: true });
    fs.writeFileSync(path.join(this.bin, "git"), `#!/bin/sh\nfor arg in "$@"; do printf '%s\\037' "$arg" >> '${this.log}'; done\nprintf '\\036' >> '${this.log}'\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  }

  /** Runs +work+ with the wrapper first on PATH. */
  async during<T>(work: () => Promise<T>): Promise<T> {
    process.env.PATH = `${this.bin}:${this.originalPath}`;
    try {
      return await work();
    } finally {
      process.env.PATH = this.originalPath;
    }
  }

  calls(): string[][] {
    if (!fs.existsSync(this.log)) return [];
    return fs
      .readFileSync(this.log, "utf8")
      .split("\u001e")
      .filter(Boolean)
      .map((call) => call.split("\u001f").filter(Boolean));
  }
}

/** A loopback server that records every connection made to it and answers none. */
export class NetworkTrap {
  readonly connections: string[] = [];
  url = "";
  private readonly server = net.createServer((socket) => {
    this.connections.push(`${socket.remoteAddress}:${socket.remotePort}`);
    socket.destroy();
  });

  static async open(): Promise<NetworkTrap> {
    const trap = new NetworkTrap();
    await new Promise<void>((resolve) => trap.server.listen(0, "127.0.0.1", resolve));
    trap.url = `http://127.0.0.1:${(trap.server.address() as net.AddressInfo).port}`;
    return trap;
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

export const NO_NETWORK_CALLS = { "dns.lookup": 0, "dns.resolve": 0, "dns.promises.lookup": 0, "net.connect": 0, "net.createConnection": 0, fetch: 0 };

/**
 * Spies on name resolution, sockets, and fetch while +run+ executes, and
 * returns how many times each was called. Calls pass through to the real
 * functions. Restoring a spy clears its calls, so they are counted first.
 */
export async function countNetworkCalls(run: () => Promise<void>): Promise<typeof NO_NETWORK_CALLS> {
  const spies = {
    "dns.lookup": vi.spyOn(dns, "lookup"),
    "dns.resolve": vi.spyOn(dns, "resolve"),
    "dns.promises.lookup": vi.spyOn(dns.promises, "lookup"),
    "net.connect": vi.spyOn(net, "connect"),
    "net.createConnection": vi.spyOn(net, "createConnection"),
    fetch: vi.spyOn(globalThis, "fetch"),
  };
  let counts = NO_NETWORK_CALLS;
  try {
    await run();
  } finally {
    counts = Object.fromEntries(Object.entries(spies).map(([name, spy]) => [name, spy.mock.calls.length])) as typeof NO_NETWORK_CALLS;
    for (const spy of Object.values(spies)) spy.mockRestore();
  }
  return counts;
}
