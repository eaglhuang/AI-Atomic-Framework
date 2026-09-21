import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(root, '.github', 'workflows', 'ci.yml');
const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'validate';

assert.ok(existsSync(workflowPath), 'Product CI workflow is missing');
const workflow = readFileSync(workflowPath, 'utf8');
const productStart = workflow.indexOf('  product-ci:');
const dogfoodStart = workflow.indexOf('  atm-dogfood:');
assert.ok(productStart >= 0 && dogfoodStart > productStart, 'Product CI job boundary is missing');
const productJob = workflow.slice(productStart, dogfoodStart);

assert.match(workflow, /on:\s+[\s\S]*schedule:\s+[\s\S]*cron:\s*['"]\d+ \d+ \* \* \*['"]/,
  'workflow must retain a daily schedule');
assert.match(workflow, /push:\s+[\s\S]*branches:\s+[\s\S]*- main/, 'workflow must retain protected-main push observations');
assert.match(productJob, /name: Product CI/, 'scheduled workflow must retain Product CI');
assert.doesNotMatch(productJob, /npm publish|id-token:\s*write|contents:\s*write/, 'Product CI must not publish or write tokens');
assert.doesNotMatch(productJob, /\bneeds:/, 'Product CI must remain independent of Dogfood diagnostics');
assert.match(productJob, /validate:package-install|npm pack --workspaces --dry-run/, 'schedule must exercise the installable product contract');

console.log(`[product-ci-burn-in-schedule:${mode}] ok (daily protected-main schedule, read-only permissions, independent Product CI)`);
