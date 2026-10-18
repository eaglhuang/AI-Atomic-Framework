import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDeterministicTaskIntent, extractPromptFileTokens } from '../../packages/cli/src/commands/next/route-resolution/intent.ts';

// A newcomer's first prompts name the file to change. ATM must read the file
// name (not the sentence around it), must not treat an ordinary README edit as
// a missing task card, and must offer a claim command that already carries
// the named file instead of a <path> placeholder.
assert.deepEqual(extractPromptFileTokens('Fix the typo in README.md'), ['README.md']);
assert.deepEqual(extractPromptFileTokens('Fix typo in docs/guide.md.'), ['docs/guide.md']);
assert.deepEqual(extractPromptFileTokens('Add cartTotal in src/cart.js that sums item.price*qty'), ['src/cart.js']);
assert.deepEqual(extractPromptFileTokens('完成 docs/plans/計畫書.md 的任務卡'), ['docs/plans/計畫書.md']);
assert.deepEqual(extractPromptFileTokens('Update "My Plans/plan one.md" and don\'t touch it'), ['My Plans/plan one.md']);
assert.deepEqual(extractPromptFileTokens('see https://example.com/a.md'), []);
assert.deepEqual(createDeterministicTaskIntent('Fix the typo in README.md').mentionedPlanPaths, []);
assert.deepEqual(createDeterministicTaskIntent('Close the task card in docs/plans/plan.md').mentionedPlanPaths, ['docs/plans/plan.md']);

const publicCli = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'cli', 'src', 'atm-public.ts')).href;
function atm(cwd: string, args: string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify([...args, '--cwd', cwd, '--json'])], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  return JSON.parse(out.slice(out.indexOf('{')));
}
const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const root = mkdtempSync(path.join(os.tmpdir(), 'prompt-named-file-'));
const project = path.join(root, 'shop');
try {
  mkdirSync(path.join(project, 'src'), { recursive: true });
  writeFileSync(path.join(project, 'README.md'), '# Shop teh app\n');
  git(project, ['init', '-q']);
  git(project, ['config', 'user.name', 'N']);
  git(project, ['config', 'user.email', 'n@example.com']);
  atm(project, ['init']);
  git(project, ['add', '-A']);
  git(project, ['commit', '-qm', 'init', '--no-verify']);

  const codeChange = atm(project, ['next', '--prompt', 'Add a cartTotal function in src/cart.js']).evidence.nextAction;
  assert.match(codeChange.suggestedRoutes[0].command, /--prompt "quick fix: Add a cartTotal function in src\/cart\.js"/);
  assert.doesNotMatch(codeChange.suggestedRoutes[0].command, /<path>/);

  const readmeEdit = atm(project, ['next', '--prompt', 'Update the intro in README.md']).evidence.nextAction;
  assert.ok(readmeEdit.suggestedRoutes?.length, `a README edit is not a dead end, got ${readmeEdit.status}`);
  assert.doesNotMatch(readmeEdit.command, /<current user prompt>/, 'the next command is not a rerun of the same prompt');
  const claimArgs = readmeEdit.suggestedRoutes[0].command.match(/--prompt "([^"]+)"/)[1];
  const claimed = atm(project, ['next', '--claim', '--actor', 'ai-a', '--prompt', claimArgs]);
  assert.deepEqual(claimed.evidence?.quickfixLock?.allowedFiles, ['README.md'], `suggested claim works, got ${(claimed.messages ?? []).map((entry: { code: string }) => entry.code).join(',')}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: prompts that name a file route to a claim for that file');
