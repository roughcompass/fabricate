import { type PlaywrightTestConfig, defineConfig, devices } from "@playwright/test";

export interface E2eOptions {
  testDir: string;
  testIgnore?: string[];
  port: number;
  env: Record<string, string>;
  /** The shell command that clears the run's throwaway storage before the server migrates its database. */
  reset: string;
  reporter?: PlaywrightTestConfig["reporter"];
  reuseExistingServer?: boolean;
}

/**
 * What every browser-test configuration shares. Tests share one server and
 * database, so they run serially in one worker, against a development server
 * on +port+ with a throwaway database. `test.only` fails a CI run.
 */
export function e2eConfig({ testDir, testIgnore, port, env, reset, reporter = [["list"]], reuseExistingServer = false }: E2eOptions) {
  const baseURL = `http://127.0.0.1:${port}`;
  return defineConfig({
    testDir,
    testIgnore,
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: 0,
    reporter,
    use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", reducedMotion: "reduce" },
    projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1280, height: 900 } } }],
    webServer: {
      command: `${reset} && npm run db:migrate && npx next dev --port ${port} --hostname 127.0.0.1`,
      env,
      url: `${baseURL}/api/health`,
      reuseExistingServer,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  });
}
