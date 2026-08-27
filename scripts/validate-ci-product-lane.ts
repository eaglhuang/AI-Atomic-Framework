import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(root, '.github', 'workflows', 'ci.yml');
const reportPath = path.join(root, 'docs', 'reports', 'atm-product-ci-burn-in.md');
const remote = process.argv.includes('--remote');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[ci-product-lane:validate] ${message}`);
}

function readText(filePath: string): string {
  assert(existsSync(filePath), `required file is missing: ${path.relative(root, filePath)}`);
  return readFileSync(filePath, 'utf8');
}

function readJson(command: readonly string[]): unknown {
  const stdout = execFileSync('gh', command, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(stdout) as unknown;
}

function validateWorkflow(): void {
  const workflow = readText(workflowPath);
  assert(/product-ci:\s*\r?\n\s*name: Product CI/.test(workflow), 'Product CI must be a named independent job');
  assert(/atm-dogfood:\s*\r?\n\s*name: ATM Dogfood/.test(workflow), 'ATM Dogfood must remain visible as a separate job');
  const productSlice = workflow.slice(workflow.indexOf('  product-ci:'), workflow.indexOf('  atm-dogfood:'));
  assert(!/\bneeds:/.test(productSlice), 'Product CI must not depend on ATM Dogfood');
  for (const requiredStep of ['npm ci', 'npm run typecheck', 'npx eslint scripts/validate-ci-product-lane.ts tests/cli/ci-product-lane-contract.test.ts', 'ci-product-lane-contract.test.ts', 'validate-package-skeleton.ts', 'npm pack --workspaces --dry-run', 'npm ci --ignore-scripts']) {
    assert(productSlice.includes(requiredStep), `Product CI is missing required step: ${requiredStep}`);
  }
}

function validateReportShape(): void {
  const report = readText(reportPath);
  for (const heading of ['# ATM Product CI burn-in', '## Protected-main verification', '## Run ledger']) {
    assert(report.includes(heading), `burn-in report is missing ${heading}`);
  }
}

function validateRemote(): void {
  const protection = readJson(['api', 'repos/eaglhuang/AI-Atomic-Framework/branches/main/protection']) as { required_status_checks?: { contexts?: unknown } };
  const contexts = Array.isArray(protection.required_status_checks?.contexts) ? protection.required_status_checks.contexts.map(String) : [];
  assert(contexts.some((context) => context === 'Product CI' || context.endsWith('/ Product CI')), 'main must require the Product CI status');

  const runs = readJson(['api', 'repos/eaglhuang/AI-Atomic-Framework/actions/workflows/ci.yml/runs?branch=main&per_page=10']) as { workflow_runs?: unknown };
  const ciRuns = Array.isArray(runs.workflow_runs)
    ? runs.workflow_runs.filter((entry: any) => entry?.path === '.github/workflows/ci.yml').slice(0, 10)
    : [];
  assert(ciRuns.length === 10, 'protected-main burn-in requires ten ci runs');
  const releaseCandidateRuns = ciRuns.filter((run: any) => String(run?.display_title ?? '').includes('release-candidate'));
  assert(releaseCandidateRuns.length >= 2, 'protected-main burn-in requires at least two release-candidate ci runs');
  for (const run of ciRuns as Array<{ id?: unknown }>) {
    const jobs = readJson(['api', `repos/eaglhuang/AI-Atomic-Framework/actions/runs/${String(run.id)}/jobs`]) as { jobs?: unknown };
    const product = Array.isArray(jobs.jobs) ? jobs.jobs.find((entry: any) => entry?.name === 'Product CI') : null;
    assert(product?.conclusion === 'success', `Product CI must be green for workflow run ${String(run.id)}`);
  }
}

validateWorkflow();
validateReportShape();
if (remote) validateRemote();
console.log(`[ci-product-lane:validate] ok (${remote ? 'contract + remote protection and burn-in' : 'contract'})`);
