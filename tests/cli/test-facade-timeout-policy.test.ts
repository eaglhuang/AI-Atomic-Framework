import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const config = JSON.parse(
  readFileSync(path.join(root, "scripts/validators.config.json"), "utf8"),
);
const skew = config.validators.find(
  (entry: any) => entry?.name === "validate-skew-matrix",
);
const facade = readFileSync(
  path.join(root, "scripts/validate-test-facade.ts"),
  "utf8",
);
const implementation = readFileSync(
  path.join(root, "scripts/run-validators/implementation.ts"),
  "utf8",
);

assert.equal(
  Number.isInteger(skew?.performanceBudgetMs),
  true,
  "skew policy must declare a performance budget",
);
assert.equal(
  Number.isInteger(skew?.performanceTimeoutMs),
  true,
  "skew policy must declare its fail-closed timeout",
);
assert.ok(
  skew.performanceTimeoutMs > skew.performanceBudgetMs,
  "timeout must be a recovery envelope, not the performance budget",
);
assert.ok(
  skew.performanceTimeoutMs >= 300_000,
  "loaded skew execution needs the measured Windows recovery envelope",
);
assert.doesNotMatch(
  facade,
  /--validator-timeout-ms[\s\S]{0,80}120000/,
  "facade must not embed the former 120 second timeout",
);
assert.match(
  facade,
  /timedOut === false/,
  "facade must reject timeout or retry-to-green behavior",
);
assert.match(
  implementation,
  /timedOut/,
  "validator summary must expose the timeout outcome",
);

console.log("[test-facade-timeout-policy] ok");
