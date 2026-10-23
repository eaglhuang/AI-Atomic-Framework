import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readActiveQuickfixLock } from '../../packages/cli/src/commands/work-channels.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-generator-pair-'));
const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
git('init', '-q');
git('config', 'user.name', 'fixture');
git('config', 'user.email', 'fixture@example.invalid');
mkdirSync(path.join(cwd, '.atm'), { recursive: true });
writeFileSync(path.join(cwd, '.atm/config.json'), JSON.stringify({ schemaVersion: 'atm.config.v0.1', layoutVersion: 2 }));
const generation = 'research/paper-v2/prereg-v3-kits/cli-0.1.22-v14-367';
const files = [`${generation}/bin/generate-unified-patch.mjs`, `${generation}/bin/unified-patch.generated.mjs`];
const sealed = 'research/paper-v2/prereg-v3-kits/sealed/README.md';
mkdirSync(path.dirname(path.join(cwd, sealed)), { recursive: true });
writeFileSync(path.join(cwd, sealed), 'sealed evidence\n');
git('add', '.');
git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'seal prior generation');
const claim = (scope: string[], prompt: string) => {
  const result = spawnSync(process.execPath, [process.env.ATM_GENPAIR_TEST_SOURCE === '1' ? 'atm.dev.mjs' : 'atm.mjs',
    'next', '--cwd', cwd, '--claim', '--actor', 'fixture', '--prompt', prompt, '--files', scope.join(','), '--json'],
  { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined, result.stderr);
  return JSON.parse(result.stdout);
};
const prompt = `quick fix: regenerate ${files[1]} with ${files[0]} for issue 374, never change old kit`;
const result = claim(files, prompt);
assert.equal(result.ok, true);
assert.equal(result.evidence.nextAction.status, 'ready');
assert.ok(result.evidence.nextAction.playbook);
assert.equal(result.evidence.nextAction.recommendedChannel, 'fast');
assert.deepEqual(readActiveQuickfixLock(cwd)?.allowedFiles, files);
assert.equal(readActiveQuickfixLock(cwd)?.maxChangedLines, 80);
const refused = claim([sealed], 'quick fix sealed evidence');
assert.equal(refused.ok, false);
assert.equal(refused.evidence.nextAction.reasonCode, 'ATM_QUICKFIX_IMMUTABLE_RESEARCH_GENERATION');
assert.deepEqual(readActiveQuickfixLock(cwd)?.allowedFiles, files, 'sealed refusal preserves the prior scope');
console.log('ok - packaged next claims a new generator/output pair and protects sealed generations');
