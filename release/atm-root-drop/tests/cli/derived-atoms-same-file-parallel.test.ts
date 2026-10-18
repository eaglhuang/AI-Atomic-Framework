import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Derived atoms dogfood (TASK-ASP-0011): two tasks that change different
// functions of one file are claimed in parallel, each commit confirms the atoms
// it touched, and a later change to an atom another active task holds is
// refused. Pure import additions to the shared preamble commute.
const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
const env = { ...process.env };
delete env.ATM_LANE_SESSION_ID;
delete env.ATM_ACTOR_ID;
delete env.ATM_DERIVED_ATOMS;
function atm(cwd: string, args: string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify([...args, '--cwd', cwd, '--json'])], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  return { exitCode: run.status, json: JSON.parse(out.slice(out.indexOf('{'))) };
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const codes = (json: { messages: Array<{ code: string }> }) => json.messages.map((entry) => entry.code);
const laneOf = (json: { evidence: { nextAction: { playbook: { closePreview: { writeCommand: string } } } } }) =>
  json.evidence.nextAction.playbook.closePreview.writeCommand.match(/--lane-session (\S+)/)?.[1] ?? '';

const shopSource = [
  "import { readFileSync } from 'node:fs';",
  '',
  'export function alpha() {',
  "  return 'a';",
  '}',
  '',
  'export function beta() {',
  "  return 'b';",
  '}',
  ''
].join('\n');

const root = mkdtempSync(path.join(os.tmpdir(), 'derived-atoms-'));
const cwd = path.join(root, 'shop');
try {
  mkdirSync(cwd);
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'N']);
  git(cwd, ['config', 'user.email', 'n@example.com']);
  atm(cwd, ['bootstrap']);
  mkdirSync(path.join(cwd, 'src'));
  writeFileSync(path.join(cwd, 'src', 'shop.ts'), shopSource);
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'init', '--no-verify']);
  for (const actor of ['ai-a', 'ai-b']) atm(cwd, ['identity', 'set', '--actor', actor, '--git-name', actor, '--git-email', `${actor}@example.com`]);
  for (const [actor, title] of [['ai-a', 'Change alpha'], ['ai-b', 'Change beta']]) {
    const open = atm(cwd, ['taskflow', 'open', '--write', '--actor', actor, '--title', title, '--goal', title, '--scope-path', 'src/shop.ts', '--validator', 'node --version']);
    assert.equal(open.exitCode, 0, JSON.stringify(open.json.messages));
  }
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'cards', '--no-verify']);

  // Claim-time reservation: both tasks hold the same file but different atoms.
  const claimA = atm(cwd, ['next', '--claim', '--actor', 'ai-a', '--task', 'TASK-SHOP-0001', '--auto-intent', '--atoms', 'alpha']);
  assert.equal(claimA.exitCode, 0, JSON.stringify(claimA.json.messages));
  const claimB = atm(cwd, ['next', '--claim', '--actor', 'ai-b', '--task', 'TASK-SHOP-0002', '--auto-intent', '--atoms', 'beta,gamma']);
  assert.equal(claimB.exitCode, 0, JSON.stringify(claimB.json.messages));
  const registry = JSON.parse(readFileSync(path.join(cwd, '.atm', 'runtime', 'write-broker.registry.json'), 'utf8'));
  const intentOf = (taskId: string) => registry.activeIntents.find((intent: { taskId: string }) => intent.taskId === taskId);
  assert.equal(intentOf('TASK-SHOP-0001').resourceKeys.atomCids.length, 1, 'alpha is reserved for task A');
  assert.equal(intentOf('TASK-SHOP-0002').resourceKeys.atomCids.length, 1, 'beta is reserved for task B; gamma does not exist yet');
  assert.notEqual(intentOf('TASK-SHOP-0001').resourceKeys.atomCids[0], intentOf('TASK-SHOP-0002').resourceKeys.atomCids[0]);

  // Task B changes beta and adds an import: confirmed, recorded on its intent.
  writeFileSync(path.join(cwd, 'src', 'shop.ts'), shopSource
    .replace("import { readFileSync } from 'node:fs';", "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';")
    .replace("return 'b';", "return 'B';"));
  const commitB = atm(cwd, ['git', 'commit', '--actor', 'ai-b', '--task', 'TASK-SHOP-0002', '--message', 'feat: beta', '--auto-stage', '--lane-session', laneOf(claimB.json)]);
  assert.equal(commitB.exitCode, 0, JSON.stringify(commitB.json.messages));
  const confirmedB = commitB.json.evidence.derivedAtomConfirmation;
  assert.deepEqual(confirmedB.files[0].atoms.map((atom: { symbol: string }) => atom.symbol).sort(), ['#preamble', 'beta']);
  assert.equal(confirmedB.files[0].preambleAdditive, true);
  assert.equal(confirmedB.recordedOnBrokerIntent, true);

  // Task A touching beta (held by B) is refused before the commit is written.
  const headBefore = git(cwd, ['rev-parse', 'HEAD']).stdout.trim();
  writeFileSync(path.join(cwd, 'src', 'shop.ts'), readFileSync(path.join(cwd, 'src', 'shop.ts'), 'utf8').replace("return 'B';", "return 'bb';"));
  const clash = atm(cwd, ['git', 'commit', '--actor', 'ai-a', '--task', 'TASK-SHOP-0001', '--message', 'feat: alpha', '--auto-stage', '--lane-session', laneOf(claimA.json)]);
  assert.equal(clash.exitCode, 1);
  assert.ok(codes(clash.json).includes('ATM_GIT_DERIVED_ATOM_CONFLICT'), JSON.stringify(clash.json.messages));
  assert.equal(git(cwd, ['rev-parse', 'HEAD']).stdout.trim(), headBefore, 'nothing was committed');

  // Task A changing only alpha plus another pure import addition commutes.
  git(cwd, ['checkout', '--', 'src/shop.ts']);
  writeFileSync(path.join(cwd, 'src', 'shop.ts'), readFileSync(path.join(cwd, 'src', 'shop.ts'), 'utf8')
    .replace("import { join } from 'node:path';", "import { join } from 'node:path';\nimport { EOL } from 'node:os';")
    .replace("return 'a';", "return 'A';"));
  const commitA = atm(cwd, ['git', 'commit', '--actor', 'ai-a', '--task', 'TASK-SHOP-0001', '--message', 'feat: alpha', '--auto-stage', '--lane-session', laneOf(claimA.json)]);
  assert.equal(commitA.exitCode, 0, JSON.stringify(commitA.json.messages));
  assert.deepEqual(commitA.json.evidence.derivedAtomConfirmation.files[0].atoms.map((atom: { symbol: string }) => atom.symbol).sort(), ['#preamble', 'alpha']);

  // Removing an import is not additive: it conflicts with the preamble B confirmed.
  writeFileSync(path.join(cwd, 'src', 'shop.ts'), readFileSync(path.join(cwd, 'src', 'shop.ts'), 'utf8').replace(/import \{ EOL \} from 'node:os';\r?\n/, ''));
  const removal = atm(cwd, ['git', 'commit', '--actor', 'ai-a', '--task', 'TASK-SHOP-0001', '--message', 'chore: drop import', '--auto-stage', '--lane-session', laneOf(claimA.json)]);
  assert.ok(codes(removal.json).includes('ATM_GIT_DERIVED_ATOM_CONFLICT'), JSON.stringify(removal.json.messages));
  git(cwd, ['checkout', '--', 'src/shop.ts']);

  // ATM_DERIVED_ATOMS=off keeps today's file-level behaviour.
  env.ATM_DERIVED_ATOMS = 'off';
  writeFileSync(path.join(cwd, 'src', 'shop.ts'), readFileSync(path.join(cwd, 'src', 'shop.ts'), 'utf8').replace("return 'A';", "return 'AA';"));
  const disabled = atm(cwd, ['git', 'commit', '--actor', 'ai-a', '--task', 'TASK-SHOP-0001', '--message', 'feat: alpha again', '--auto-stage', '--lane-session', laneOf(claimA.json)]);
  assert.equal(disabled.exitCode, 0, JSON.stringify(disabled.json.messages));
  assert.equal(disabled.json.evidence.derivedAtomConfirmation, undefined);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: same-file different-atom tasks run in parallel; overlapping atoms are refused at commit');
