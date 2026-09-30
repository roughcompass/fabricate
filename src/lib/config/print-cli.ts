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
console.log(
  `Analysis budgets:   ${Object.entries(config.analysis)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ")}`,
);
