import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { readActiveQuickfixLock } from '../../packages/cli/src/commands/work-channels.ts';
import { resolveActiveRunnerPublicationTask } from '../../scripts/sealed-runner-publication.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-scope-seal-'));
const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (file: string, value: unknown) => {
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  writeFileSync(path.join(cwd, file), typeof value === 'string' ? value : JSON.stringify(value));
};
git('init', '-q');
git('config', 'user.name', 'fixture');
git('config', 'user.email', 'fixture@example.invalid');
write('.atm/config.json', { schemaVersion: 'atm.config.v0.1', layoutVersion: 2 });
if (!process.argv.includes('--seal-only')) {
  const file = '/workspace/codex-runs/formal-runs-plan.md';
  const prompt = `write ${file} documenting count arms seeds and budget`;
  const guidance = await runNext(['--cwd', cwd, '--actor', 'fixture', '--prompt', prompt]);
  assert.ok(JSON.stringify(guidance).includes(`quick fix: ${prompt}`));
  const result = await runNext(['--cwd', cwd, '--claim', '--actor', 'fixture', '--prompt', `quick fix: ${prompt}`]);
  assert.equal((result.evidence?.nextAction as { status: string })?.status, 'ready');
  assert.deepEqual(readActiveQuickfixLock(cwd)?.allowedFiles, [file]);
  assert.equal(readActiveQuickfixLock(cwd)?.maxChangedLines, 80);
  console.log('ok - suggested fast fallback grants an exact absolute-file claim');
}
if (!process.argv.includes('--scope-only')) {
  write('packages/cli/src/fixture.ts', 'export {};\n');
  git('add', 'packages');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'committed framework source');
  const taskId = 'ATM-FRAMEWORK-TEMP-fixture';
  const lock = { workItemId: taskId, actorId: 'fixture', heartbeatAt: new Date().toISOString(), ttlSeconds: 14400, files: ['packages/cli/src/fixture.ts'] };
  const lockPath = `.atm/runtime/locks/${taskId}.lock.json`;
  const resolve = (actorId = 'fixture') => resolveActiveRunnerPublicationTask({ cwd, actorId, now: new Date().toISOString() });
  write(lockPath, lock);
  assert.equal(resolve(), taskId);
  assert.throws(() => resolve('other'), /found 0/);
  for (const overrides of [{ status: 'released' }, { heartbeatAt: '2000-01-01T00:00:00Z' }, { laneSessionId: 'foreign-lane' }, { files: ['docs/only.md'] }]) {
    write(lockPath, { ...lock, ...overrides });
    assert.throws(() => resolve(), /found 0/);
  }
  write(lockPath, lock);
  write('packages/cli/src/fixture.ts', '// uncommitted\n');
  assert.throws(() => resolve(), /found 0/);
  console.log('ok - committed source claim refreshes runner; dirty, expired, released, foreign claims fail closed');
}
