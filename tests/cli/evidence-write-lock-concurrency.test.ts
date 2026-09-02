import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-evidence-write-lock-'));
const taskId = 'TASK-GOV-0408-CONCURRENCY';
const workerPath = path.join(cwd, 'evidence-writer.ts');
const runnerUrl = pathToFileURL(path.resolve(process.cwd(), 'packages/cli/src/commands/evidence/verbs/run.ts')).href;

function waitForLock(lockPath: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (existsSync(lockPath)) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for evidence lock: ${lockPath}`));
        return;
      }
      setTimeout(check, 20);
    };
    check();
  });
}

function startWriter(actor: string, holdMs: number): Promise<{ exitCode: number | null; output: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--strip-types', workerPath, cwd, taskId, actor], {
      cwd: process.cwd(),
      env: { ...process.env, ATM_EVIDENCE_TEST_HOLD_LOCK_MS: String(holdMs) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', (exitCode) => {
      try {
        resolve({ exitCode, output: JSON.parse(stdout) as Record<string, unknown> });
      } catch (error) {
        reject(new Error(`Evidence writer emitted invalid JSON (stderr: ${stderr}): ${String(error)}`));
      }
    });
  });
}

try {
  writeFileSync(workerPath, `
    import { runEvidenceRun } from ${JSON.stringify(runnerUrl)};
    import { CliError } from ${JSON.stringify(pathToFileURL(path.resolve(process.cwd(), 'packages/cli/src/commands/shared.ts')).href)};
    const [cwd, taskId, actor] = process.argv.slice(2);
    try {
      const result = runEvidenceRun([
        '--task', taskId,
        '--cwd', cwd,
        '--actor', actor,
        '--command', 'node -e "process.exit(0)"',
        '--validators', 'gov0408-evidence-lock-probe',
        '--runner-kind', 'dev-source',
        '--json'
      ]);
      process.stdout.write(JSON.stringify({ ok: result.ok }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        ok: false,
        code: error instanceof CliError ? error.code : null,
        message: error instanceof Error ? error.message : String(error)
      }));
    }
  `, 'utf8');

  const lockPath = path.join(cwd, '.atm', 'runtime', 'evidence-write-locks', `${taskId}.lock`);
  const first = startWriter('gov0408-first-writer', 7_000);
  await waitForLock(lockPath, 2_000);
  const second = startWriter('gov0408-second-writer', 0);
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.exitCode, 0);
  assert.equal(firstResult.output.ok, true);
  assert.equal(secondResult.exitCode, 0);
  assert.equal(secondResult.output.ok, false);
  assert.equal(secondResult.output.code, 'ATM_EVIDENCE_WRITE_LOCK_CONFLICT');
  assert.equal(existsSync(lockPath), false, 'the successful writer must remove its lock');

  const evidence = JSON.parse(readFileSync(path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.json`), 'utf8')) as {
    evidence?: unknown[];
  };
  assert.equal(evidence.evidence?.length, 1, 'the losing writer must not append partial evidence');
  console.log('[evidence-write-lock-concurrency] ok');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
