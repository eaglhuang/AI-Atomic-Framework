import assert from 'node:assert/strict';
import { existsSync, globSync, readFileSync } from 'node:fs';
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
assert.match(workflow, /release_candidate:/, 'workflow_dispatch must support release-candidate burn-in runs');
assert.match(workflow, /run-name: Product CI burn-in/, 'workflow runs must expose their burn-in classification');
const productJob = workflow.slice(productStart, dogfoodStart);
for (const [name, job] of [['Product CI', productJob], ['ATM Dogfood', workflow.slice(dogfoodStart)]]) {
  const checkout = job.match(/uses: actions\/checkout@v4\s*\r?\n([\s\S]*?)(?=\r?\n      - name:)/)?.[1];
  assert.ok(checkout, `${name} must retain a checkout step`);
  assert.match(checkout, /fetch-depth: 0/, `${name} must preserve full commit ancestry`);
  assert.match(checkout, /filter: blob:none/, `${name} must avoid eagerly transferring unused historical blobs`);
}
assert.match(productJob, /name: Product CI/);
assert.doesNotMatch(productJob, /\bneeds:/, 'Product CI must be independent of dogfood diagnostics');
for (const command of ['npm ci', 'npm run build -- --validation-only', 'npm run typecheck', 'npx eslint scripts/validate-ci-product-lane.ts tests/cli/ci-product-lane-contract.test.ts', 'ci-product-lane-contract.test.ts', 'run-cli-test-sweep.ts', 'npm test', 'validate-package-skeleton.ts', 'npm run validate:package-install', 'npm pack --workspaces --dry-run', 'npm ci --ignore-scripts']) {
  assert.ok(productJob.includes(command), `Product CI must run ${command}`);
}

const report = readFileSync(reportPath, 'utf8');
assert.match(report, /## Protected-main verification/);
assert.match(report, /## Run ledger/);

// npm makes workspace bin targets executable on POSIX during `npm ci`.  The
// tracked mode must therefore already be executable, otherwise CI observes a
// generated runner change that no sealed publication inventory can own.
const rootManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { workspaces: readonly string[] };
assert.ok(Array.isArray(rootManifest.workspaces) && rootManifest.workspaces.length > 0, 'workspace patterns must be declared');
const workspaceManifests = globSync(rootManifest.workspaces.map((pattern) => `${pattern}/package.json`), { cwd: root }).sort();
assert.ok(workspaceManifests.length > 0, 'workspace bin checks must inspect actual package manifests');
let workspaceBinCount = 0;
for (const manifestPath of workspaceManifests) {
  const manifest = JSON.parse(readFileSync(path.join(root, manifestPath), 'utf8')) as {
    bin?: string | Readonly<Record<string, string>>;
  };
  const targets = typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin ?? {});
  for (const target of targets) {
    const binPath = path.relative(root, path.resolve(root, path.dirname(manifestPath), target)).split(path.sep).join('/');
    const mode = execFileSync('git', ['ls-files', '--stage', '--', binPath], { cwd: root, encoding: 'utf8' })
      .trim()
      .split(/\s+/)[0];
    assert.equal(mode, '100755', `${binPath} must be tracked as an executable npm bin target`);
    workspaceBinCount += 1;
  }
}
assert.ok(workspaceBinCount > 0, 'workspace executable-mode contract must cover at least one bin');

execFileSync(process.execPath, ['--strip-types', validatorPath], { cwd: root, stdio: 'inherit' });
console.log('[ci-product-lane-contract.test] ok');
