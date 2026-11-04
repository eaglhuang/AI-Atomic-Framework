import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { readActiveQuickfixLock } from '../../packages/cli/src/commands/work-channels.ts';

function initRepo(prefix: string) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), prefix));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 'fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(path.join(cwd, '.atm'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm/config.json'), JSON.stringify({ schemaVersion: 'atm.config.v0.1', layoutVersion: 2 }));
  return { cwd, git };
}

const { cwd, git } = initRepo('atm-seal-condition-');
const sealed = 'research/paper-v2/prereg-v3-kits/sealed/README.md';
const sealedSums = 'research/paper-v2/prereg-v3-kits/sealed/SHA256SUMS';
mkdirSync(path.dirname(path.join(cwd, sealed)), { recursive: true });
writeFileSync(path.join(cwd, sealed), 'sealed evidence\n');
writeFileSync(path.join(cwd, sealedSums), 'sealed\n');
git('add', '.');
git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'seal prior generation');

const seal = 'research/paper-v2/prereg-v3-kits/cli-0.1.22-v14-367/SHA256SUMS';
const condition = 'research/paper-v2/prereg-v3-conditions/2026-10-24-v14-three-arm-smoke.md';
const smoke = 'research/paper-v2/prereg-v3-smoke/2026-10-24-v14-three-arm/CONDITION.md';
const files = [seal, condition, smoke].sort();
const prompt = `quick fix: seal ${seal} and record smoke condition ${condition} plus ${smoke}`;
const claim = (scopePrompt: string, scope?: readonly string[]) => runNext([
  '--cwd', cwd, '--claim', '--actor', 'fixture', '--prompt', scopePrompt,
  ...(scope ? ['--files', scope.join(',')] : [])
]);
const result = await claim(prompt);
const nextAction = result.evidence.nextAction as { status?: string; playbook?: unknown; recommendedChannel?: string; reasonCode?: string };
assert.equal(result.ok, true);
assert.equal(nextAction.status, 'ready');
assert.ok(nextAction.playbook);
assert.equal(nextAction.recommendedChannel, 'fast');
assert.deepEqual(readActiveQuickfixLock(cwd)?.allowedFiles, files);
assert.equal(readActiveQuickfixLock(cwd)?.maxChangedLines, 80);
console.log('ok - prompt-only kit seal and smoke condition claim returns the fast playbook');

for (const blocked of [[sealed], [sealedSums], ['research/paper-v2/patches/paper_edit_r6.py']]) {
  const refused = await claim('quick fix sealed evidence', blocked);
  assert.equal(refused.ok, false);
  assert.equal((refused.evidence.nextAction as { reasonCode?: string }).reasonCode, 'ATM_QUICKFIX_IMMUTABLE_RESEARCH_GENERATION');
  assert.equal((refused.evidence.nextAction as { playbook?: unknown }).playbook, undefined);
  assert.deepEqual(readActiveQuickfixLock(cwd)?.allowedFiles, files);
}
console.log('ok - committed seals and non-condition collection files stay immutable');

const core = initRepo('atm-seal-core-');
core.git('add', '.');
core.git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'anchor');
const coreFile = 'packages/cli/src/commands/next.ts';
const coreClaim = await runNext(['--cwd', core.cwd, '--claim', '--actor', 'fixture', '--prompt', 'quickfix a typo', '--files', coreFile]);
assert.equal((coreClaim.evidence.nextAction as { recommendedChannel?: string }).recommendedChannel, 'fast');
assert.ok((coreClaim.evidence.nextAction as { playbook?: unknown }).playbook);
await assert.rejects(() => runNext([
  '--cwd', core.cwd, '--claim', '--actor', 'fixture', '--prompt', 'quickfix a typo',
  '--files', [coreFile, 'packages/cli/src/commands/work-channels.ts', 'packages/core/src/index.ts', 'packages/cli/src/commands/next/channel-strategy.ts'].join(',')
]), { code: 'ATM_QUICKFIX_FILE_LIMIT_EXCEEDED' });
assert.deepEqual(readActiveQuickfixLock(core.cwd)?.allowedFiles, [coreFile]);
console.log('ok - in-limit core code still claims; four governance files stay over the quickfix limit');
