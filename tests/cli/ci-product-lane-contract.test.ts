import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = path.join(root, '.github', 'workflows', 'ci.yml');
const validatorPath = path.join(root, 'scripts', 'validate-ci-product-lane.ts');
const reportPath = path.join(root, 'docs', 'reports', 'atm-product-ci-burn-in.md');

for (const filePath of [workflowPath, validatorPath, reportPath]) {
  assert.ok(existsSync(filePath), `TASK-PRF-0003 deliverable is missing: ${path.relative(root, filePath)}`);
}

const workflow = readFileSync(workflowPath, 'utf8');
const productStart = workflow.indexOf('  product-ci:');
const dogfoodStart = workflow.indexOf('  atm-dogfood:');
assert.ok(productStart >= 0 && dogfoodStart > productStart, 'workflow must declare Product CI before ATM Dogfood');
const productJob = workflow.slice(productStart, dogfoodStart);
assert.match(productJob, /name: Product CI/);
assert.doesNotMatch(productJob, /\bneeds:/, 'Product CI must be independent of dogfood diagnostics');
for (const command of ['npm ci', 'npm run typecheck', 'npm run lint', 'ci-product-lane-contract.test.ts', 'validate-package-skeleton.ts', 'npm pack --workspaces --dry-run', 'npm ci --ignore-scripts']) {
  assert.ok(productJob.includes(command), `Product CI must run ${command}`);
}

const report = readFileSync(reportPath, 'utf8');
assert.match(report, /## Protected-main verification/);
assert.match(report, /## Run ledger/);

execFileSync(process.execPath, ['--strip-types', validatorPath], { cwd: root, stdio: 'inherit' });
console.log('[ci-product-lane-contract.test] ok');
