import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A claim that outlives its ticket (about 30 minutes of work) made the next
// commit fail with "Ticket expiry requires a governed claim renewal and
// ticket reseal." and no command. The refusal must name the renewal, and the
// printed command must work as printed.
const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
function atm(cwd: string, args: readonly string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const env = { ...process.env, ATM_LANE_SESSION_ID: '', ATM_ACTOR_ID: '', AGENT_IDENTITY: '' };
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify(args)], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.split(/\r?\n/).filter((line) => !/^\(node:\d+\)|^\(Use `node/.test(line)).join('\n');
  return JSON.parse(out.slice(out.indexOf('{')));
}
function argvOf(command: string): string[] {
  const tokens = [...command.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((match) => match[1] ?? match[2]);
  assert.deepEqual(tokens.slice(0, 2), ['node', 'atm.mjs'], command);
  return tokens.slice(2);
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const codes = (result: { messages?: { code: string }[] }) => (result.messages ?? []).map((entry) => entry.code);

const root = mkdtempSync(path.join(os.tmpdir(), 'stale-ticket-'));
const project = path.join(root, 'shop');
try {
  mkdirSync(path.join(project, 'src'), { recursive: true });
  git(project, ['init', '-q']);
  git(project, ['config', 'user.name', 'N']);
  git(project, ['config', 'user.email', 'n@example.com']);
  atm(project, ['bootstrap', '--cwd', project, '--json']);
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'init', '--no-verify']);
  atm(project, ['identity', 'set', '--actor', 'ai-a', '--git-name', 'AI A', '--git-email', 'ai-a@example.com', '--json']);
  const opened = atm(project, ['taskflow', 'open', '--write', '--actor', 'ai-a', '--title', 'Add a', '--goal', 'Add a', '--scope-path', 'src/a.js', '--validator', 'node --check src/a.js', '--json']);
  const taskId = opened.evidence.generation.taskId as string;
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'card', '--no-verify']);
  const claimed = atm(project, ['next', '--claim', '--actor', 'ai-a', '--task', taskId, '--json']);
  const lane = JSON.stringify(claimed).match(/lane-\d+-ai-a-[0-9a-f]+/)?.[0] ?? '';

  // Let the ticket expire.
  const ledgerPath = path.join(project, '.atm', 'history', 'tasks', `${taskId}.json`);
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  ledger.workAdmissionTicket.expiresAt = '2000-01-01T00:00:00.000Z';
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

  writeFileSync(path.join(project, 'src', 'a.js'), 'export const a = 1;\n');
  const commit = ['git', 'commit', '--actor', 'ai-a', '--task', taskId, '--message', 'feat: a', '--auto-stage', '--lane-session', lane, '--json'];
  const stale = atm(project, commit);
  const refusal = (stale.messages ?? []).find((entry: { code: string }) => entry.code === 'ATM_WRITE_TICKET_STALE');
  assert.ok(refusal, codes(stale).join(','));
  const renew = String(refusal.data?.requiredCommand ?? '');
  assert.match(renew, new RegExp(`^node atm\\.mjs tasks renew --task ${taskId} --actor ai-a .*--json$`));

  const renewed = atm(project, argvOf(renew));
  assert.equal(renewed.ok, true, `the printed renewal works: ${JSON.stringify(renewed.messages)}`);
  const landed = atm(project, commit);
  assert.ok(codes(landed).includes('ATM_GIT_COMMIT_OK'), `the commit lands after renewal: ${codes(landed).join(',')}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: a stale ticket refusal names a working renewal');
