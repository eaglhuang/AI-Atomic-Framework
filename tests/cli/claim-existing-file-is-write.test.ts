import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A new card that edits an existing file must be claimed for writing. The
// auto intent used to treat any recent commit that touched only that file as
// this card's delivery, claimed it closeout-only, and every delivery commit
// was refused with ATM_WORK_ADMISSION_DELIVERY_NOT_AUTHORIZED.
const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
function atm(cwd: string, args: readonly string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify([...args, '--json'])], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  return JSON.parse(out.slice(out.indexOf('{')));
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const codes = (result: { messages?: { code: string }[] }) => (result.messages ?? []).map((entry) => entry.code);

const root = mkdtempSync(path.join(os.tmpdir(), 'claim-existing-file-'));
const project = path.join(root, 'shop');
try {
  mkdirSync(path.join(project, 'src'), { recursive: true });
  git(project, ['init', '-q']);
  git(project, ['config', 'user.name', 'N']);
  git(project, ['config', 'user.email', 'n@example.com']);
  atm(project, ['bootstrap', '--cwd', project]);
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'init', '--no-verify']);
  // The file already exists, committed on its own before any card.
  writeFileSync(path.join(project, 'src', 'shop.js'), "export const name = 'shop';\n");
  git(project, ['add', 'src/shop.js']);
  git(project, ['commit', '-qm', 'add shop', '--no-verify']);

  atm(project, ['identity', 'set', '--actor', 'ai-a', '--git-name', 'AI A', '--git-email', 'ai-a@example.com']);
  const opened = atm(project, ['taskflow', 'open', '--write', '--actor', 'ai-a', '--title', 'Rename shop', '--goal', 'Rename shop', '--scope-path', 'src/shop.js', '--validator', 'node --check src/shop.js']);
  const taskId = opened.evidence.generation.taskId as string;
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'card', '--no-verify']);

  const claimed = atm(project, ['next', '--claim', '--actor', 'ai-a', '--task', taskId]);
  assert.equal(claimed.ok, true, codes(claimed).join(','));
  assert.equal(claimed.evidence.nextAction.claimIntent, 'write', 'a card that edits an existing file is claimed for writing');
  const lane = JSON.stringify(claimed).match(/lane-\d+-ai-a-[0-9a-f]+/)?.[0];
  assert.ok(lane);

  writeFileSync(path.join(project, 'src', 'shop.js'), "export const name = 'store';\n");
  const committed = atm(project, ['git', 'commit', '--actor', 'ai-a', '--task', taskId, '--message', 'feat: rename shop', '--auto-stage', '--lane-session', lane]);
  assert.ok(codes(committed).includes('ATM_GIT_COMMIT_OK'), `the delivery commit is admitted, got ${codes(committed).join(',')}`);
  assert.match(readFileSync(path.join(project, 'src', 'shop.js'), 'utf8'), /store/);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: a card that edits an existing file is claimed for writing and commits');
