import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addBitbucketToken, deleteBitbucketToken } from "@/lib/admin/bitbucket-tokens";
import { mirrorPath } from "@/lib/acquisition/mirror";
import { type FrontendRegistryConfig, withOverrides } from "@/lib/config";
import { GitRunner } from "@/lib/git/runner";
import { profileDocument, profileOfSurvey } from "@/lib/profiles/profile-records";
import { CloneUrl } from "@/lib/repositories/clone-url";
import { type Repository, insertRepository } from "@/lib/repositories/repository-records";
import { processTarget } from "@/lib/runs/orchestration";
import { getTarget } from "@/lib/runs/run-records";
import { surveyRepository } from "@/lib/surveys/background";
import { surveyById } from "@/lib/surveys/records";
import { runSurvey } from "@/lib/surveys/run";
import { useAcquisitionWorld } from "../support/acquisition";
import { buildRun } from "../support/builders";
import { fakeExecutable } from "../support/fake-git";
import { type GitHttpAnswer, type GitHttpRequest, type HttpsGitServer, type TestCertificates, errorPacket, startHttpsGitServer, testCertificates } from "../support/https-git";
import { manifest } from "../support/profiles";

/*
 * Saved Bitbucket tokens on the worker's Git reads (use-saved-git-tokens,
 * tasks 3.1 and 3.2), against a controlled HTTPS Git endpoint that serves
 * a private repository only to the synthetic token: a Run target and a
 * background request resolve its reference, and the survey job fetches the
 * commit its mirror lacks and profiles it, each sending the token saved for
 * the server; a redirect gets no token; a rejected token fails acquisition
 * with an authentication failure that doesn't show it.
 */

const TOKEN = "BBDC-c3ludGhldGljOnZhbGlkLXRva2VuLTAwMDE";
const REVOKED = "BBDC-c3ludGhldGljOnJldm9rZWQtdG9rZW4tMDI";
const REPOSITORY = "/team/app.git";
const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

describe("saved Bitbucket tokens on Git reads", () => {
  const world = useAcquisitionWorld("saved-tokens");
  let certificates: TestCertificates;
  let server: HttpsGitServer;
  let route: (request: GitHttpRequest) => GitHttpAnswer | undefined;
  let head: string;
  const cleanups: (() => unknown)[] = [];

  beforeAll(() => {
    certificates = testCertificates();
  });
  afterAll(() => certificates.cleanup());

  beforeEach(async () => {
    const work = world.fixture.repo("work/app");
    head = work.write("package.json", manifest({ name: "app", version: "1.0.0", dependencies: { react: "^19.0.0" } })).commit();
    world.fixture.bare(`remotes${REPOSITORY}`, { from: work });
    route = () => undefined;
    server = await serve((request) => route(request) ?? (request.authorization === `Bearer ${TOKEN}` && request.path.startsWith(`/bitbucket/scm${REPOSITORY}/`) ? { serve: REPOSITORY } : unauthorized));
  });
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  const unauthorized: GitHttpAnswer = { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Bitbucket"' }, body: "Authentication required" };

  /** An HTTPS Git server for the fixture's remotes, closed after the test. */
  async function serve(answer: (request: GitHttpRequest) => GitHttpAnswer): Promise<HttpsGitServer> {
    const started = await startHttpsGitServer({ root: path.join(world.fixture.root, "remotes"), certificates, route: answer });
    cleanups.push(() => started.close());
    return started;
  }

  /** Git as the worker runs it, trusting the test authority through http.sslCAInfo alone, with verification on. */
  function trustingRunner(config: FrontendRegistryConfig = world.config): GitRunner {
    const trusting = fakeExecutable(`exec '${realGit}' -c http.sslCAInfo='${certificates.caFile}' "$@"`);
    cleanups.push(trusting.cleanup);
    return new GitRunner({ config, executable: trusting.executable });
  }

  function register(url: string): Repository {
    return insertRepository(world.db, { name: "app", cloneUrl: url, canonicalUrl: CloneUrl.parse(url).canonical });
  }

  const saveToken = (serverUrl: string, token: string) => addBitbucketToken(world.db, { name: "Platform team", serverUrl, token });

  /** A Run over +repository+ with its target processed as the worker does: resolved, and waiting on its survey or failed. */
  async function processRun(repository: Repository, runner: GitRunner, config = world.config) {
    const { targets } = buildRun(world.db, { repositories: [repository] });
    return processTarget(world.db, targets[0]!.publicId, { config, runner });
  }

  /** The requests since the first +from+, each as its method, path without the query, and Authorization header. */
  const requestsFrom = (from: number) => server.requests.slice(from).map((request) => [request.method, request.path.replace(/\?.*/, ""), request.authorization]);
  const INFO_REFS = ["GET", `/bitbucket/scm${REPOSITORY}/info/refs`, `Bearer ${TOKEN}`];
  const UPLOAD_PACK = ["POST", `/bitbucket/scm${REPOSITORY}/git-upload-pack`, `Bearer ${TOKEN}`];

  /** Every stored value outside the token table, and every file in repository storage, that holds +secret+. */
  function placesHolding(secret: string): string[] {
    const tables = world.db.$client.prepare("select name from sqlite_master where type = 'table' and name not in ('bitbucket_tokens', 'sqlite_sequence')").pluck().all() as string[];
    const rows = tables.filter((table) => JSON.stringify(world.db.$client.prepare(`select * from "${table}"`).all()).includes(secret));
    const files = (fs.readdirSync(world.config.repositoryStorage, { recursive: true }) as string[])
      .map((relative) => path.join(world.config.repositoryStorage, relative))
      .filter((file) => fs.statSync(file).isFile() && fs.readFileSync(file).includes(secret));
    return [...rows, ...files];
  }

  it("authenticates the ref advertisement and the object fetch with the saved token, then profiles the commit the mirror lacked", async () => {
    saveToken(`${server.origin}/bitbucket`, TOKEN);
    const app = register(`${server.origin}/bitbucket/scm${REPOSITORY}`);
    const runner = trustingRunner();
    expect(fs.existsSync(mirrorPath(world.config.repositoryStorage, app.publicId))).toBe(false);

    // A Run target resolves its reference: the ref advertisement, which protocol v2 lists with ls-refs.
    const target = await processRun(app, runner);
    expect(target).toMatchObject({ state: "analyzing", resolvedRef: "refs/heads/main", surveyId: expect.any(Number) });
    const advertisement = requestsFrom(0);
    expect(advertisement[0]).toEqual(INFO_REFS);
    expect(advertisement.every((request) => request[2] === `Bearer ${TOKEN}`)).toBe(true);
    expect(surveyById(world.db, target.surveyId!).commitSha).toBe(head);

    // The survey job fetches the commit its mirror lacks, sending the token with the objects' request too, then profiles it.
    const survey = await runSurvey(world.db, surveyById(world.db, target.surveyId!).publicId, { config: world.config, runner });
    expect(survey).toMatchObject({ state: "succeeded", commitSha: head, failureCode: null });
    const fetch = requestsFrom(advertisement.length);
    expect(fetch[0]).toEqual(INFO_REFS);
    expect(fetch).toContainEqual(UPLOAD_PACK);
    expect(fetch.every((request) => request[2] === `Bearer ${TOKEN}`)).toBe(true);
    expect(profileDocument(profileOfSurvey(world.db, survey.id)!)).toMatchObject({ commit: head });
    expect(getTarget(world.db, target.publicId)).toMatchObject({ state: "complete" });

    // A background request resolves the reference with it too, and finds the Profile current.
    expect(await surveyRepository(world.db, app, "manual", { config: world.config, runner })).toMatchObject({ status: "current", survey: { id: survey.id } });
    expect(requestsFrom(advertisement.length + fetch.length)).toEqual(advertisement);

    // The token is in no job, survey, target, Profile, or file Git wrote, the mirror's configuration included.
    expect(placesHolding(TOKEN)).toEqual([]);
  });

  it("sends no token to where a redirect points: Git follows none and the failure names the canonical clone URL", async () => {
    const elsewhere = await serve(() => ({ serve: REPOSITORY }));
    route = (request) => (request.path.startsWith("/bitbucket/scm/team/moved.git/") ? { status: 302, headers: { Location: `${elsewhere.origin}${request.path.replace("/team/moved.git/", `${REPOSITORY}/`)}` } } : undefined);
    const saved = saveToken(`${server.origin}/bitbucket`, TOKEN);
    const moved = register(`${server.origin}/bitbucket/scm/team/moved.git`);

    const failed = await processRun(moved, trustingRunner());

    expect(failed).toMatchObject({ state: "failed", failureCode: "source_unavailable", surveyId: null });
    expect(failed.failureMessage).toMatch(/redirected Git.*canonical clone URL/);
    expect(server.requests).toEqual([{ method: "GET", path: "/bitbucket/scm/team/moved.git/info/refs?service=git-upload-pack", authorization: `Bearer ${TOKEN}` }]);
    expect(elsewhere.requests).toEqual([]);

    // Without a saved token for its server, Git follows the redirect as before, carrying no token.
    deleteBitbucketToken(world.db, saved.publicId);
    const followed = await processRun(moved, trustingRunner());
    expect(followed).toMatchObject({ state: "analyzing", resolvedRef: "refs/heads/main" });
    expect(surveyById(world.db, followed.surveyId!).commitSha).toBe(head);
    expect(elsewhere.requests.length).toBeGreaterThan(0);
    expect(elsewhere.requests.every((request) => request.authorization === null)).toBe(true);
  });

  it("fails acquisition with a redacted authentication failure when the server rejects the token, trying no credential helper", async () => {
    // A credential helper that would answer with the token the server accepts, in Basic form, if Git asked it.
    const helper = fakeExecutable(`[ "$1" = get ] && printf 'username=x-token-auth\\npassword=${TOKEN}\\n'`, "git-credential-test");
    cleanups.push(helper.cleanup);
    const config = withOverrides(world.config, { gitCredentialHelper: helper.executable });
    const basic = `Basic ${Buffer.from(`x-token-auth:${TOKEN}`).toString("base64")}`;
    route = (request) => (request.authorization === basic ? { serve: REPOSITORY } : undefined);
    saveToken(`${server.origin}/bitbucket`, REVOKED);
    const app = register(`${server.origin}/bitbucket/scm${REPOSITORY}`);

    const failed = await processRun(app, trustingRunner(config), config);

    expect(failed).toMatchObject({ state: "failed", failureCode: "authentication_failed", surveyId: null });
    expect(failed.failureMessage).toMatch(/^The source refused access/);
    expect(server.requests.map((request) => request.authorization)).toEqual([`Bearer ${REVOKED}`]);
    expect(placesHolding(REVOKED)).toEqual([]);
  });

  it("removes the token from a rejection that repeats it, in a Run target's failure and in a survey's", async () => {
    const saved = saveToken(`${server.origin}/bitbucket`, TOKEN);
    const app = register(`${server.origin}/bitbucket/scm${REPOSITORY}`);
    const runner = trustingRunner();
    const target = await processRun(app, runner);

    // The token is replaced by one the server rejects with an error naming it, before the survey fetches.
    deleteBitbucketToken(world.db, saved.publicId);
    saveToken(`${server.origin}/bitbucket/`, REVOKED);
    route = (request) =>
      request.authorization === `Bearer ${REVOKED}` ? { status: 200, headers: { "Content-Type": "application/x-git-upload-pack-advertisement" }, body: errorPacket(`access denied: ${REVOKED} was revoked`) } : undefined;

    const survey = await runSurvey(world.db, surveyById(world.db, target.surveyId!).publicId, { config: world.config, runner });
    expect(survey).toMatchObject({ state: "failed", failureCode: "authentication_failed" });
    expect(survey.failureMessage).toContain("access denied: [REDACTED] was revoked");
    expect(getTarget(world.db, target.publicId)).toMatchObject({ state: "failed" });

    const failed = await processRun(app, runner);
    expect(failed).toMatchObject({ state: "failed", failureCode: "authentication_failed" });
    expect(failed.failureMessage).toContain("[REDACTED] was revoked");
    expect(placesHolding(REVOKED)).toEqual([]);
  });
});
