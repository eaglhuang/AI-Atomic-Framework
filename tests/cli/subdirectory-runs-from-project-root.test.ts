import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// An agent that cd's into src/ and runs ATM must reach the project, not be
// told to bootstrap a second, nested ATM install there. An independent Git
// repository nested inside the project is never redirected to its parent.
const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
function atmIn(processCwd: string, args: string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify([...args, '--json'])], { cwd: processCwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  return JSON.parse(out.slice(out.indexOf('{')));
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const same = (left: string, right: string) => realpathSync(left).toLowerCase() === realpathSync(right).toLowerCase();

const root = mkdtempSync(path.join(os.tmpdir(), 'subdir-root-'));
const project = path.join(root, 'shop');
try {
  mkdirSync(path.join(project, 'src', 'deep'), { recursive: true });
  git(project, ['init', '-q']);
  git(project, ['config', 'user.name', 'N']);
  git(project, ['config', 'user.email', 'n@example.com']);
  atmIn(project, ['bootstrap', '--cwd', project]);
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'init', '--no-verify']);

  for (const args of [['next'], ['next', '--cwd', '.']]) {
    const result = atmIn(path.join(project, 'src', 'deep'), args);
    assert.notEqual(result.evidence?.nextAction?.status, 'needs-bootstrap', `${args.join(' ')} from src/deep must not ask for bootstrap`);
    assert.ok(same(result.cwd, project), `${args.join(' ')} runs in the project root, got ${result.cwd}`);
  }
  assert.equal(existsSync(path.join(project, 'src', '.atm')), false, 'no nested .atm was created');

  // An explicit, different --cwd is respected.
  const explicit = atmIn(project, ['next', '--cwd', path.join(project, 'src')]);
  assert.ok(same(explicit.cwd, path.join(project, 'src')));

  // A nested independent repository keeps its own (unbootstrapped) identity.
  const nested = path.join(project, 'vendor', 'lib');
  mkdirSync(nested, { recursive: true });
  git(nested, ['init', '-q']);
  const nestedResult = atmIn(nested, ['next']);
  assert.ok(same(nestedResult.cwd, nested), 'a nested git repository is not redirected to its parent');
  assert.equal(nestedResult.evidence?.nextAction?.status, 'needs-bootstrap');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: commands run from a subdirectory resolve the ATM project root');
