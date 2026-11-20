import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import type { ServerResponse } from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

/*
 * A controlled HTTPS Git endpoint for tests: a TLS server on 127.0.0.1 with a
 * certificate from a throwaway certificate authority, which answers each
 * request as the test's route says: by serving a bare repository through
 * `git http-backend`, or with a status of its own, such as a 401 or a
 * redirect. It records every request with the Authorization header it
 * carried. Git trusts the authority only through a test-only
 * `http.sslCAInfo` (trustingGit), so TLS verification stays on.
 */

export interface TestCertificates {
  /** The authority's certificate, for http.sslCAInfo. */
  caFile: string;
  key: Buffer;
  cert: Buffer;
  cleanup(): void;
}

/** A certificate authority and a certificate for 127.0.0.1 and localhost that it signed, valid for a day. */
export function testCertificates(): TestCertificates {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "https-git-certs-"));
  const file = (name: string) => path.join(directory, name);
  const request = (commonName: string, extensions: string) => `[req]\ndistinguished_name = dn\nprompt = no\nx509_extensions = ext\n[dn]\nCN = ${commonName}\n[ext]\n${extensions}\n`;
  fs.writeFileSync(file("ca.cnf"), request("Frontend Registry test authority", "basicConstraints = critical, CA:TRUE\nkeyUsage = critical, keyCertSign, cRLSign"));
  fs.writeFileSync(file("server.cnf"), request("127.0.0.1", "basicConstraints = critical, CA:FALSE\nkeyUsage = critical, digitalSignature, keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = IP:127.0.0.1, DNS:localhost"));
  const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: directory, stdio: ["ignore", "ignore", "pipe"] });
  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "1", "-config", "ca.cnf");
  openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-config", "server.cnf");
  openssl("x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-set_serial", "2", "-days", "1", "-out", "server.pem", "-extfile", "server.cnf", "-extensions", "ext");
  return { caFile: file("ca.pem"), key: fs.readFileSync(file("server.key")), cert: fs.readFileSync(file("server.pem")), cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

/** A request the server received: its method, path and query, and its Authorization header, if any. */
export interface GitHttpRequest {
  method: string;
  path: string;
  authorization: string | null;
}

/** How to answer a request: serve +repository+ (a path under the server's root, such as /team/app.git), or answer with a status of the route's own. */
export type GitHttpAnswer = { serve: string } | { status: number; headers?: Record<string, string>; body?: string };

export interface HttpsGitServer {
  /** https://127.0.0.1:<port> */
  readonly origin: string;
  readonly requests: GitHttpRequest[];
  close(): Promise<void>;
}

/** Starts an HTTPS Git server for the bare repositories under +root+, answering each request as +route+ says. */
export async function startHttpsGitServer(options: { root: string; certificates: TestCertificates; route: (request: GitHttpRequest) => GitHttpAnswer }): Promise<HttpsGitServer> {
  const requests: GitHttpRequest[] = [];
  const server = https.createServer({ key: options.certificates.key, cert: options.certificates.cert }, (req, res) => {
    const url = new URL(req.url ?? "/", "https://127.0.0.1");
    const request = { method: req.method ?? "GET", path: `${url.pathname}${url.search}`, authorization: req.headers.authorization ?? null };
    requests.push(request);
    const answer = options.route(request);
    if (!("serve" in answer)) {
      req.resume();
      res.writeHead(answer.status, answer.headers ?? {});
      res.end(answer.body ?? "");
      return;
    }
    const pathInfo = `${answer.serve}${url.pathname.slice(url.pathname.indexOf(".git/") + 4)}`;
    // The CGI environment `git http-backend` reads; Next.js types require NODE_ENV on ProcessEnv, which it doesn't need.
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      GIT_PROJECT_ROOT: options.root,
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: pathInfo,
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: request.method,
      CONTENT_TYPE: req.headers["content-type"] ?? "",
      HTTP_CONTENT_ENCODING: req.headers["content-encoding"] ?? "",
      GIT_PROTOCOL: String(req.headers["git-protocol"] ?? ""),
      REMOTE_ADDR: "127.0.0.1",
    };
    const backend = spawn("git", ["http-backend"], { env: env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "ignore"] });
    req.pipe(backend.stdin!);
    respondFromCgi(backend.stdout!, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `https://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Relays a CGI response, its Status and other headers, then its body. */
function respondFromCgi(output: NodeJS.ReadableStream, res: ServerResponse): void {
  let head = Buffer.alloc(0);
  let started = false;
  output.on("data", (chunk: Buffer) => {
    if (started) return void res.write(chunk);
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf("\r\n\r\n");
    if (end < 0) return;
    started = true;
    let status = 200;
    const headers: Record<string, string> = {};
    for (const line of head.subarray(0, end).toString("latin1").split("\r\n")) {
      const colon = line.indexOf(":");
      const [name, value] = [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
      if (name.toLowerCase() === "status") status = Number.parseInt(value, 10);
      else headers[name] = value;
    }
    res.writeHead(status, headers);
    res.write(head.subarray(end + 4));
  });
  output.on("end", () => res.end());
}

/** A pkt-line Git reads as the server's error, such as `ERR access denied`. */
export function errorPacket(message: string): string {
  const line = `ERR ${message}\n`;
  return `${(line.length + 4).toString(16).padStart(4, "0")}${line}`;
}
