import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The card already declares its validators; the playbook a claim returns
// must name them in its evidence step instead of a "<validator>" placeholder.
const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
function atm(cwd: string, args: readonly string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify([...args, '--json'])], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  return JSON.parse(out.slice(out.indexOf('{')));
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const root = mkdtempSync(path.join(os.tmpdir(), 'claim-validators-'));
const project = path.join(root, 'shop');
try {
  mkdirSync(path.join(project, 'src'), { recursive: true });
  git(project, ['init', '-q']);
  git(project, ['config', 'user.name', 'N']);
  git(project, ['config', 'user.email', 'n@example.com']);
  atm(project, ['bootstrap', '--cwd', project]);
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'init', '--no-verify']);
  const validators = ['node --check src/checkout.js', 'node src/checkout.test.js'];
  const opened = atm(project, ['taskflow', 'open', '--write', '--actor', 'ai-a', '--title', 'Add checkout', '--goal', 'Add checkout', '--scope-path', 'src/checkout.js,src/checkout.test.js', '--validator', validators.join(',')]);
  assert.equal(opened.ok, true, JSON.stringify(opened.messages));
  const taskId = opened.evidence.generation.taskId as string;

  const claimed = atm(project, ['next', '--claim', '--actor', 'ai-a', '--task', taskId]);
  assert.equal(claimed.ok, true, JSON.stringify(claimed.messages));
  const sequence = claimed.evidence.nextAction.playbook.commandSequence as string[];
  const evidenceSteps = sequence.filter((command) => command.includes(' evidence run '));
  assert.equal(evidenceSteps.length, validators.length, `one evidence step per declared validator: ${JSON.stringify(evidenceSteps)}`);
  validators.forEach((validator, index) => assert.ok(evidenceSteps[index].includes(`--command "${validator}"`), evidenceSteps[index]));
  assert.ok(sequence.every((command) => !command.includes('<validator>')));
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: a claimed card playbook names its declared validators');
