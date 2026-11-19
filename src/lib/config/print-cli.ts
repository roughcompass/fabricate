// Prints the effective safety configuration: `npm run config`.
import { getConfig } from ".";

const config = getConfig();
const list = (values: readonly string[]) => (values.length ? values.join(", ") : "(none)");

console.log(`Environment:        ${config.environment}`);
console.log(`Allowed roots:      ${list(config.allowedRoots)}`);
console.log(`Denied roots:       ${list(config.deniedRoots)}`);
console.log(`Database:           ${config.database}`);
console.log(`Repository storage: ${config.repositoryStorage}`);
console.log(`Git timeout:        ${config.gitTimeoutSeconds}s (lock wait ${config.gitLockTimeoutSeconds}s)`);
console.log(`Credential helper:  ${config.gitCredentialHelper ?? "(none)"}`);
console.log(`Worker concurrency: ${config.workerConcurrency}`);
console.log(`Template demo:      ${config.demoEnabled ? "enabled" : "disabled"}`);
console.log(`Profiling check:    every ${config.profiling.checkMinutes} minutes`);
console.log(`Catalog registry:   ${config.catalog.registry}`);
console.log(`Adoption:           snapshot every ${config.adoption.snapshotDays} days, rarely used at the ${config.adoption.rarelyUsedPercentile}th percentile`);
console.log(
  `Analysis budgets:   ${Object.entries(config.analysis)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ")}`,
);
const previews = config.previews;
console.log(`Previews:           ${previews.enabled ? "enabled" : "disabled"}`);
console.log(`Preview sources:    ${list(previews.trustedSources)}`);
console.log(`Preview Node:       ${list(Object.entries(previews.nodeVersions).map(([version, directory]) => `${version}=${directory}`))}`);
console.log(`Preview storage:    ${previews.storage}`);
console.log(`Preview browser:    ${previews.browser ?? "Playwright's Chromium"}`);
console.log(`Preview limits:     concurrency=${previews.concurrency}, timeoutMinutes=${previews.timeoutMinutes}, maxOutputBytes=${previews.maxOutputBytes}, maxStorageBytes=${previews.maxStorageBytes}`);
