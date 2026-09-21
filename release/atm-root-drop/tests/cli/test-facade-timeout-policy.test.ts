// ATM-GOV-0346 regression test.
//
// caseId: test_facade_skew_timeout_policy_0346
// semanticKey: facade_skew_timeout_policy
// coversAcceptance: ACC-1, ACC-2, ACC-3, ACC-4, ACC-5
// coversImpactEdges: skew-matrix-runtime-to-facade-timeout, timeout-result-to-fail-closed-ci-verdict
// contractEdge: validator-facade-timeout-policy
//
// A validator timeout is a fail-closed terminal verdict, never a retry point and
// never a downgrade-to-pass. The timeout budget itself must be derived from a
// declared, measured slow-path envelope plus an explicit safety margin, so that
// no validator sits on a hidden boundary and no incident-specific validator name
// is hard-coded into the runner.
//
// Runnable directly via:
//   node --strip-types tests/cli/test-facade-timeout-policy.test.ts

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VALIDATOR_TIMEOUT_EXIT_CODE,
  VALIDATOR_TIMEOUT_POLICY_SCHEMA_ID,
  classifyValidatorTermination,
  resolveValidatorTimeoutPolicy,
  resolveValidatorTimeoutPolicyDefaults,
} from "../../scripts/run-validators/implementation.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runnerPath = path.join(root, "scripts", "run-validators.ts");
const config = JSON.parse(
  readFileSync(path.join(root, "scripts/validators.config.json"), "utf8"),
);

function runFacade(args: readonly string[]): { summary: any; status: number } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--strip-types", runnerPath, ...args],
      { cwd: root, encoding: "utf8" },
    );
    return { summary: JSON.parse(stdout), status: 0 };
  } catch (error) {
    const execError = error as { stdout?: string; status?: number };
    return {
      summary: JSON.parse(String(execError.stdout ?? "{}")),
      status: execError.status ?? 1,
    };
  }
}

// --- ACC-1: one data-driven timeout contract with an explicit safety margin.

assert.equal(
  config?.timeoutPolicy?.schemaId,
  VALIDATOR_TIMEOUT_POLICY_SCHEMA_ID,
  "validators.config.json must declare one shared timeout policy contract",
);
const defaults = resolveValidatorTimeoutPolicyDefaults(config);
assert.ok(
  defaults.safetyMarginMultiplier > 1,
  "the timeout policy must carry an explicit safety margin above the observed envelope",
);
assert.ok(
  Number.isInteger(defaults.minimumTimeoutMs) && defaults.minimumTimeoutMs > 0,
  "the timeout policy must declare a positive minimum timeout floor",
);

// An envelope is only ever derived from a clean successful run, so the config
// may legitimately declare none. What must hold is the derivation itself: any
// validator that does declare one is bounded by it plus the full margin, and a
// validator without one still gets a bounded, budget-derived timeout. A
// contaminated wall clock from a run that failed on an external precondition is
// not a measurement and must never reach this path.
const measured = {
  name: "measured-validator",
  observedSlowPathMs: 40_000,
  performanceBudgetMs: 30_000,
};
const measuredPolicy = resolveValidatorTimeoutPolicy({
  validator: measured,
  defaults,
});
assert.equal(measuredPolicy.schemaId, VALIDATOR_TIMEOUT_POLICY_SCHEMA_ID);
assert.equal(measuredPolicy.source, "observed-envelope");
assert.ok(
  measuredPolicy.timeoutMs >=
    measured.observedSlowPathMs * defaults.safetyMarginMultiplier,
  "a declared envelope must keep the full safety margin",
);
assert.ok(
  measuredPolicy.timeoutMs > measured.performanceBudgetMs,
  "a timeout must be a recovery envelope, not the performance budget",
);

for (const validator of config.validators) {
  if (!Number.isInteger(validator?.observedSlowPathMs)) continue;
  const policy = resolveValidatorTimeoutPolicy({ validator, defaults });
  assert.equal(
    policy.source,
    "observed-envelope",
    `${validator.name} declares a measured envelope, so its timeout must be derived from it`,
  );
  assert.ok(
    policy.timeoutMs >=
      validator.observedSlowPathMs * defaults.safetyMarginMultiplier,
    `${validator.name} timeout must keep the full declared safety margin`,
  );
}

// A validator with no measured envelope still gets a bounded, derived timeout.
const derived = resolveValidatorTimeoutPolicy({
  validator: { name: "unmeasured-validator" },
  defaults,
});
assert.equal(derived.source, "budget-derived");
assert.ok(
  derived.timeoutMs >= defaults.minimumTimeoutMs,
  "an unmeasured validator must never fall below the policy floor",
);

// An explicit caller override wins, and is reported as such.
const overridden = resolveValidatorTimeoutPolicy({
  validator: { name: "unmeasured-validator" },
  defaults,
  overrideMs: 1,
});
assert.equal(overridden.source, "cli-override");
assert.equal(overridden.timeoutMs, 1);

// --- ACC-5: the policy carries no incident-specific rule.

const implementationSource = readFileSync(
  path.join(root, "scripts/run-validators/implementation.ts"),
  "utf8",
);
for (const forbidden of ["validate-skew-matrix", "ATM-GOV-0346"]) {
  assert.equal(
    implementationSource.includes(forbidden),
    false,
    `the validator runner must not hard-code ${forbidden}`,
  );
}

// --- ACC-2 / ACC-3: a genuine timeout is a terminal, diagnosable failure.

assert.equal(classifyValidatorTermination({ exitCode: 0, timedOut: false }), "passed");
assert.equal(classifyValidatorTermination({ exitCode: 1, timedOut: false }), "failed");
assert.equal(
  classifyValidatorTermination({
    exitCode: VALIDATOR_TIMEOUT_EXIT_CODE,
    timedOut: false,
  }),
  "failed",
  "a validator that exits with the timeout code on its own is a failure, not a timeout",
);
assert.equal(
  classifyValidatorTermination({ exitCode: 0, timedOut: true }),
  "timeout",
  "a killed validator must never be laundered into a pass by its exit status",
);

const forcedTimeout = runFacade([
  "standard",
  "--filter",
  "validate-product-charter",
  "--validator-timeout-ms",
  "1",
  "--json",
]);
assert.notEqual(
  forcedTimeout.status,
  0,
  "a forced validator timeout must fail the facade run",
);
assert.ok(
  forcedTimeout.summary.failed >= 1,
  "a forced timeout must be counted as a failure in the run summary",
);
const timedOutValidator = forcedTimeout.summary.validators?.[0];
assert.equal(timedOutValidator?.timedOut, true);
assert.equal(timedOutValidator?.ok, false);
assert.equal(timedOutValidator?.exitCode, VALIDATOR_TIMEOUT_EXIT_CODE);
assert.equal(timedOutValidator?.terminationClass, "timeout");
assert.equal(
  timedOutValidator?.timeoutDiagnostic?.code,
  "ATM_VALIDATOR_TIMEOUT",
  "a timeout must be diagnosed, not silently reported as a generic failure",
);
assert.equal(timedOutValidator?.timeoutDiagnostic?.timeoutSource, "cli-override");
assert.ok(
  timedOutValidator?.timeoutDiagnostic?.requiredCommand,
  "a timeout diagnosis must tell the operator how to reproduce it",
);
assert.deepEqual(
  forcedTimeout.summary.timeoutPolicy?.timedOutValidators,
  ["validate-product-charter"],
  "the run summary must name every validator that hit its timeout",
);

// --- ACC-2 / ACC-4: a normal completion stays observable and non-timed-out.

const normalRun = runFacade([
  "standard",
  "--filter",
  "validate-product-charter",
  "--json",
]);
assert.equal(normalRun.status, 0, "a passing validator must keep the run green");
const normalValidator = normalRun.summary.validators?.[0];
assert.equal(normalValidator?.timedOut, false);
assert.equal(normalValidator?.terminationClass, "passed");
assert.equal(
  normalValidator?.timeoutPolicy?.schemaId,
  VALIDATOR_TIMEOUT_POLICY_SCHEMA_ID,
  "each validator result must report the timeout decision that bounded it",
);
assert.ok(
  normalValidator.durationMs < normalValidator.timeoutPolicy.timeoutMs,
  "observed duration and the timeout decision must both be recorded so the margin is auditable",
);
assert.equal(
  normalRun.summary.timeoutPolicy?.schemaId,
  VALIDATOR_TIMEOUT_POLICY_SCHEMA_ID,
  "the run summary must expose the shared timeout policy for CI consumption",
);

console.log("[test-facade-timeout-policy] ok");
