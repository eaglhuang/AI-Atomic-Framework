import { path, spawn, root, formatDuration, fail, assert } from './context.ts';

export type NodeScriptTestSpec = {
  name: string;
  scriptPath: string;
};

type NodeScriptTestResult = {
  name: string;
  status: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  errorMessage: string | null;
};

async function runNodeScriptTest(spec: NodeScriptTestSpec): Promise<NodeScriptTestResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--strip-types', spec.scriptPath], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      resolve({ name: spec.name, status: null, stdout, stderr, durationMs: Date.now() - startedAt, errorMessage: error.message });
    });
    child.on('close', (status) => {
      resolve({ name: spec.name, status, stdout, stderr, durationMs: Date.now() - startedAt, errorMessage: null });
    });
  });
}

export async function runNodeScriptTestsInParallel(specs: NodeScriptTestSpec[], concurrency = specs.length) {
  if (specs.length === 0) {
    console.error('[cli] focused tests ok: none registered');
    return;
  }
  const results: NodeScriptTestResult[] = [];
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, specs.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < specs.length) {
      const spec = specs[nextIndex];
      nextIndex += 1;
      results.push(await runNodeScriptTest(spec));
    }
  }));
  const failed = results.filter((result) => result.status !== 0 || result.errorMessage);
  if (failed.length > 0) {
    for (const result of failed) {
      const output = (result.stderr || result.stdout || result.errorMessage || '').trim();
      fail(`${result.name} focused test failed after ${formatDuration(result.durationMs)}: ${output}`);
    }
    return;
  }
  const timings = results.map((result) => `${result.name}=${formatDuration(result.durationMs)}`).join(', ');
  console.error(`[cli] parallel focused tests ok: ${timings}`);
}

export function fastFocusedRegressionTests(): NodeScriptTestSpec[] {
  return [
    ['lifecycle-state', 'packages/cli/src/commands/tasks/__tests__/lifecycle-state.test.ts'],
    ['emergency-gate', 'packages/cli/src/commands/emergency/__tests__/gate.test.ts'],
    ['scope-lock-diagnostics', 'packages/cli/src/commands/tasks/__tests__/scope-lock-diagnostics.test.ts'],
    ['git-commit-closeout-only-preflight', 'tests/cli/git-commit-closeout-only-preflight.test.ts'],
    ['validator-run-resume-and-status', 'tests/cli/validator-run-resume-and-status.test.ts'],
    ['protected-override-audit-staging', 'tests/cli/protected-override-audit-staging.test.ts'],
    ['integration-raw-git-command-guard', 'tests/cli/integration-raw-git-command-guard.test.ts'],
    ['planning-root-preference', 'packages/cli/src/commands/next/__tests__/planning-root-preference.test.ts'],
    ['planning-root-canonical-preference', 'scripts/validate-planning-root-canonical-preference.ts'],
    ['residue-diagnostics', 'packages/cli/src/commands/tasks/__tests__/residue-diagnostics.test.ts'],
    ['validate-cli-historical-delivery', 'tests/cli/validate-cli-historical-delivery.test.ts'],
    ['closure-required-gates-contract', 'tests/cli/closure-required-gates-contract.test.ts'],
    ['task-audit-bulk-close-mirror', 'tests/cli/task-audit-bulk-close-mirror.test.ts']
  ].map(([name, scriptPath]) => ({ name, scriptPath: path.join(root, scriptPath) }));
}

export async function runFocusedRegressions() {
  await runNodeScriptTestsInParallel(fastFocusedRegressionTests());
  assert(!process.exitCode, 'focused regression tests must pass');
}
