import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runnerPath = path.join(root, 'scripts', 'run-sealed-runner-build.ts');
const workflowPath = path.join(root, '.github', 'workflows', 'ci.yml');
const runner = readFileSync(runnerPath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');
const validationStart = runner.indexOf('function runValidationOnlyBuild');
const validationEnd = runner.indexOf('function runSealedBuild');
assert.ok(validationStart >= 0 && validationEnd > validationStart, 'validation-only function must exist');
const validation = runner.slice(validationStart, validationEnd);

assert.match(runner, /process\.argv\.includes\('--validation-only'\)/);
assert.match(runner, /runValidationOnlyBuild\(target\)/);
assert.match(validation, /worktree', 'add', '--detach/);
assert.match(validation, /outputSnapshot/);
assert.match(validation, /outputInventoryDigest/);
assert.match(validation, /canonicalOutputDigest/);
assert.match(validation, /canonical release surfaces/);
assert.doesNotMatch(validation, /resolveSealedRunnerPublication\(/, 'validation-only must not enter publication authority');
assert.match(runner, /runSealedBuild\(target\)/, 'normal build dispatch must remain available');
assert.match(runner, /resolveSealedRunnerPublication\(/, 'normal publication path must remain claim-gated');
const productJob = workflow.slice(workflow.indexOf('  product-ci:'), workflow.indexOf('  atm-dogfood:'));
assert.match(productJob, /npm run build -- --validation-only/);
assert.doesNotMatch(productJob, /run: npm run build\s*$/m);
console.log('[runner-build-validation-only.test] ok');
