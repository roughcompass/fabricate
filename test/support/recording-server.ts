import http from "node:http";
import type { AddressInfo } from "node:net";

/*
 * A local stand-in for Studio or CDaaS that records every request it gets
 * and answers from a route table. Tests use it to prove what onboarding
 * sends, and that it never sends anything but GET.
 */

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
}

export type Responder = (request: http.IncomingMessage, response: http.ServerResponse) => void;

export interface RecordingServer {
  base: string;
  requests: RecordedRequest[];
  /** Answers +path+ (without its query string) with +responder+. */
  route(path: string, responder: Responder): void;
  close(): Promise<void>;
}

export const json = (body: unknown, status = 200): Responder => (_request, response) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

export async function recordingServer(): Promise<RecordingServer> {
  const requests: RecordedRequest[] = [];
  const routes = new Map<string, Responder>();
  const server = http.createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0]!;
    requests.push({ method: request.method!, path: request.url ?? "/", authorization: request.headers.authorization });
    const responder = routes.get(path);
    if (responder) responder(request, response);
    else response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    route: (path, responder) => void routes.set(path, responder),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A Studio module response, as the contract defines it. */
export function studioModuleResponse(uuid: string, overrides: Record<string, unknown> = {}) {
  return { id: 7, uuid, appId: "payee", title: "Payee search", url: "https://cdn.example.com/payee/mf-manifest.json", color: "#000", icon: "search", description: "", synonyms: [], sealId: 88001, status: { id: 1, name: "Active" }, version: 3, types: [{ id: 2, name: "Module Federation" }], ...overrides };
}

/** A CDaaS view-versions response, as the contract defines it. */
export function cdaasVersionsResponse(versions: { versionName: string; live?: boolean }[]) {
  return { code: "200", message: "found", lobAppVersionMetadata: versions.map((version) => ({ gitCommitHash: "abc123", branchName: "main", buildNumber: "42", repoUrl: "https://git.example.com/pay/payee", lastModified: "2026-10-03T08:00:00Z", live: false, ...version })) };
}
