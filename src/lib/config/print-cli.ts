// Prints the effective safety configuration: `npm run config`.
import { DE_CONSOLE_TOKEN, GATEWAY_CREDENTIALS, describePrototypesDatabase, getConfig } from ".";

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
console.log(`Profile:            ${config.profile}`);
const prototypes = config.prototypes;
console.log(`Prototypes:         ${prototypes.enabled ? "enabled" : "disabled"}, ${describePrototypesDatabase(prototypes.database)}`);
console.log(`Prototype models:   generate ${prototypes.models.generate}, plan ${prototypes.models.plan}, review ${prototypes.models.review}, learn ${prototypes.models.learn}`);
// Credentials are reported only as set or not set.
const credential = GATEWAY_CREDENTIALS.find((key) => process.env[key]);
console.log(`Prototype limits:   ${prototypes.dailyVariantLimit} variants a day, ${prototypes.repairAttempts} repairs, zero data retention ${prototypes.zeroDataRetention ? "on" : "off"}, ${prototypes.runner} runner, seeded examples ${prototypes.examples ? "on" : "off"}`);
console.log(`AI Gateway:         ${credential ? `${credential} set` : "no credential set"}`);
const deConsole = config.deConsole.source;
// The token is reported only as set or not set.
console.log(
  `DE Console:         ${deConsole ? `${deConsole.kind === "file" ? deConsole.path : deConsole.url}, every ${config.deConsole.refreshMinutes} minutes${deConsole.kind === "url" ? `, token ${process.env[DE_CONSOLE_TOKEN] ? "set" : "not set"}` : ""}` : "(none)"}`,
);
console.log(
  `Analysis budgets:   ${Object.entries(config.analysis)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ")}`,
);
