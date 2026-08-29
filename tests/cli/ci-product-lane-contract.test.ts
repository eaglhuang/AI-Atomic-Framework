import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = path.join(root, '.github', 'workflows', 'ci.yml');
const validatorPath = path.join(root, 'scripts', 'validate-ci-product-lane.ts');
const reportPath = path.join(root, 'docs', 'reports', 'atm-product-ci-burn-in.md');
const cliEntrypoint = 'packages/cli/dist/atm.mjs';

for (const filePath of [workflowPath, validatorPath, reportPath]) {
  assert.ok(existsSync(filePath), `TASK-PRF-0003 deliverable is missing: ${path.relative(root, filePath)}`);
}

const workflow = readFileSync(workflowPath, 'utf8');
const productStart = workflow.indexOf('  product-ci:');
const dogfoodStart = workflow.indexOf('  atm-dogfood:');
assert.ok(productStart >= 0 && dogfoodStart > productStart, 'workflow must declare Product CI before ATM Dogfood');
assert.match(workflow, /release_candidate:/, 'workflow_dispatch must support release-candidate burn-in runs');
assert.match(workflow, /run-name: Product CI burn-in/, 'workflow runs must expose their burn-in classification');
const productJob = workflow.slice(productStart, dogfoodStart);
assert.match(productJob, /name: Product CI/);
assert.doesNotMatch(productJob, /\bneeds:/, 'Product CI must be independent of dogfood diagnostics');
for (const command of ['npm ci', 'npm run typecheck', 'npx eslint scripts/validate-ci-product-lane.ts tests/cli/ci-product-lane-contract.test.ts', 'ci-product-lane-contract.test.ts', 'validate-package-skeleton.ts', 'npm pack --workspaces --dry-run', 'npm ci --ignore-scripts']) {
  assert.ok(productJob.includes(command), `Product CI must run ${command}`);
}

const report = readFileSync(reportPath, 'utf8');
assert.match(report, /## Protected-main verification/);
assert.match(report, /## Run ledger/);

// npm makes workspace bin targets executable on POSIX during `npm ci`.  The
// tracked mode must therefore already be executable, otherwise CI observes a
// generated runner change that no sealed publication inventory can own.
const cliEntrypointMode = execFileSync('git', ['ls-files', '--stage', '--', cliEntrypoint], { cwd: root, encoding: 'utf8' })
  .trim()
  .split(/\s+/)[0];
assert.equal(cliEntrypointMode, '100755', `${cliEntrypoint} must be tracked as an executable npm bin target`);

execFileSync(process.execPath, ['--strip-types', validatorPath], { cwd: root, stdio: 'inherit' });
console.log('[ci-product-lane-contract.test] ok');
