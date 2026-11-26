import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A task ledger committed with claim.state "active" keeps that state after its
// lease expires (heartbeatAt + ttlSeconds < now). Every clone then saw the
// expired claim as the current active task and next --prompt blocked unrelated
// work with ATM_NEXT_ACTIVE_TASK_DIVERGENCE_BLOCKED. Divergence must consider
// only live claims (canonical isLiveActiveClaim), while a live claim still blocks.
const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
function atm(cwd: string, args: readonly string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify([...args, '--json'])], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.split(/\r?\n/).filter((line) => !/^\(node:\d+\)|^\(Use `node/.test(line)).join('\n');
  return JSON.parse(out.slice(out.indexOf('{')));
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const root = mkdtempSync(path.join(os.tmpdir(), 'divergence-expired-lease-'));
const project = path.join(root, 'shop');
try {
  mkdirSync(path.join(project, 'src'), { recursive: true });
  writeFileSync(path.join(project, 'README.md'), '# Shop teh app\n');
  git(project, ['init', '-q']);
  git(project, ['config', 'user.name', 'N']);
  git(project, ['config', 'user.email', 'n@example.com']);
  atm(project, ['bootstrap', '--cwd', project]);
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'init', '--no-verify']);
  const opened = atm(project, ['taskflow', 'open', '--write', '--actor', 'ai-a', '--title', 'Add a', '--goal', 'Add a', '--scope-path', 'src/a.js', '--validator', 'node --check src/a.js']);
  const taskId = opened.evidence.generation.taskId as string;
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'card', '--no-verify']);
  assert.equal(atm(project, ['next', '--claim', '--actor', 'ai-a', '--task', taskId]).ok, true);

  const live = atm(project, ['next', '--prompt', 'Fix the typo in README.md']);
  assert.equal(live.evidence.nextAction.status, 'active-task-divergence-blocked', 'a live claim must still block divergent work');

  const ledgerPath = path.join(project, '.atm', 'history', 'tasks', `${taskId}.json`);
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  assert.equal(ledger.claim?.state, 'active');
  const stale = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  ledger.claim.heartbeatAt = stale;
  ledger.claim.claimedAt = stale;
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

  const expired = atm(project, ['next', '--prompt', 'Fix the typo in README.md']);
  assert.notEqual(expired.evidence.nextAction.status, 'active-task-divergence-blocked', `an expired lease must not block divergent work: ${JSON.stringify(expired.messages)}`);
  assert.ok(!(expired.messages ?? []).some((entry: { code: string }) => entry.code === 'ATM_NEXT_ACTIVE_TASK_DIVERGENCE_BLOCKED'), 'no divergence error for an expired lease');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: an expired-lease claim no longer blocks unrelated work via active-task divergence');
