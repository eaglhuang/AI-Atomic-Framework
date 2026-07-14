import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ATOMIZATION_DEFAULT_MAX_LINES,
  EXTRACTION_FIRST_LINE_BUDGET,
  resolveAtomizationLinePolicy
} from '../../packages/cli/src/commands/tasks/task-import-validators.ts';

assert.equal(ATOMIZATION_DEFAULT_MAX_LINES, 600);
assert.equal(EXTRACTION_FIRST_LINE_BUDGET, ATOMIZATION_DEFAULT_MAX_LINES);
assert.equal(resolveAtomizationLinePolicy().maxLines, 600);
assert.equal(resolveAtomizationLinePolicy({ config: { atomization: { maxLines: 480 } } }).maxLines, 480);
assert.throws(
  () => resolveAtomizationLinePolicy({ config: { atomization: { maxLines: 601 } }, now: new Date('2026-07-15T00:00:00.000Z') }),
  /requires atomization\.waiver\.expiresAt/
);
assert.equal(
  resolveAtomizationLinePolicy({
    config: { atomization: { maxLines: 700, waiver: { reason: 'temporary split window', expiresAt: '2026-07-16T00:00:00.000Z' } } },
    now: new Date('2026-07-15T00:00:00.000Z')
  }).waiverValid,
  true
);

const schemaText = readFileSync(path.join(process.cwd(), 'schemas', 'atm-config.schema.json'), 'utf8');
assert.ok(schemaText.includes('"atomization"'), 'atm config schema must expose atomization policy');
assert.ok(schemaText.includes('"minimum": 601'), 'schema must require a waiver when maxLines raises the default');

const temp = mkdtempSync(path.join(tmpdir(), 'atm-atomization-lines-'));
try {
  mkdirSync(path.join(temp, '.atm'), { recursive: true });
  const shortFile = path.join(temp, 'short.ts');
  const longFile = path.join(temp, 'long.ts');
  writeFileSync(shortFile, 'a\nb\nc\n', 'utf8');
  writeFileSync(longFile, Array.from({ length: 11 }, (_, index) => `line${index}`).join('\n'), 'utf8');
  writeFileSync(path.join(temp, '.atm', 'config.json'), JSON.stringify({ atomization: { maxLines: 10 } }, null, 2), 'utf8');

  const ok = runAtomFileSize(temp, ['--files', 'short.ts']);
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  assert.equal(JSON.parse(ok.stdout).maxLines, 10);

  const fail = runAtomFileSize(temp, ['--files', 'long.ts']);
  assert.equal(fail.status, 1, 'repo-lowered cap must fail files above atomization.maxLines');
  assert.equal(JSON.parse(fail.stderr).maxLines, 10);

  const override = runAtomFileSize(temp, ['--max-lines', '12', '--files', 'long.ts']);
  assert.equal(override.status, 0, override.stderr || override.stdout);
  assert.equal(JSON.parse(override.stdout).policy.source, 'override');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function runAtomFileSize(cwd: string, args: readonly string[]) {
  return spawnSync(
    process.execPath,
    ['--strip-types', path.join(process.cwd(), 'packages', 'cli', 'src', 'commands', 'git-governance', 'validate-atom-file-size.ts'), ...args],
    { cwd, encoding: 'utf8' }
  );
}

console.log('[atomization-max-lines] ok');
