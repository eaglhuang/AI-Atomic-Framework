// Contract test for the clean-install gate. The published 0.1.0 tarball
// passed a version-only smoke while shipping no governance/default-guards
// schema source: module resolution was clean, `atm --version` exited 0, and
// `bootstrap` exited 0, but `atm-chart render` failed for every adopter with
// ATM_CHART_SCHEMA_SOURCE_MISSING. A version-only gate cannot observe a
// missing runtime data asset, so the gate must execute commands that actually
// consume one. This is a static test over the validator source, matching the
// tests/cli/release-public-registry-gate.test.ts pattern.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(root, 'scripts', 'validate-package-skeleton.ts'), 'utf8');

const smokeMatch = source.match(/function runInstallSmoke\(\): void \{([\s\S]*?)\n\}/);
assert.ok(smokeMatch, 'validate-package-skeleton.ts must define runInstallSmoke');
const smoke = smokeMatch[1];

// The gate must drive a command that consumes a packaged runtime data asset.
for (const command of ['bootstrap', 'atm-chart', 'render', 'verify']) {
  assert.ok(
    smoke.includes(`'${command}'`),
    `clean-install smoke must exercise "${command}" so a missing runtime data asset cannot pass a version-only check`
  );
}

// Every core-workflow command must fail the gate on a non-zero exit, rather
// than being recorded and ignored.
assert.match(
  smoke,
  /if \(result\.status !== 0\) \{[\s\S]*?throw new Error\(/,
  'a non-zero core-workflow exit code must throw, not be recorded as a passing result'
);

// The receipt must carry the per-command exit codes as evidence.
assert.match(
  smoke,
  /coreWorkflowExitCodes/,
  'the clean-install receipt must record per-command core-workflow exit codes'
);

// The commands must run against an isolated consumer workflow directory, not
// the framework repo itself, or the gate would read the repo's own .atm state
// and mask a tarball that ships nothing.
assert.match(
  smoke,
  /path\.join\(consumerRoot, 'workflow'\)/,
  'core-workflow commands must run in an isolated consumer directory, not the framework repo'
);

console.log('[clean-install-core-workflow-gate.test] ok');
