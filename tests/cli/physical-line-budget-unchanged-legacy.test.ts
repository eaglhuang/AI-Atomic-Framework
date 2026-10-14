import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectTouchedPhysicalLineBudget } from '../../packages/cli/src/commands/git-governance/commit-scope-policy.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-legacy-line-budget-'));
const git = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  git(['init', '-q']);
  git(['config', 'user.name', 'fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  const file = 'legacy.ts';
  const baseline = Array.from({ length: 650 }, (_, i) => `export const value${i} = ${i};`).join('\n') + '\n';
  writeFileSync(path.join(cwd, file), baseline, 'utf8');
  git(['add', '--', file]);
  git(['commit', '-m', 'legacy baseline']);
  const inspect = () => inspectTouchedPhysicalLineBudget(cwd, [file], { gate: 'claim' });
  assert.equal(inspect().ok, true, 'merely selecting an unchanged legacy source must not block a claim');
  writeFileSync(path.join(cwd, file), baseline.replace('value0 = 0', 'value0 = 1'), 'utf8');
  assert.equal(inspect().ok, true, 'the existing bounded no-growth exception is preserved');
  writeFileSync(path.join(cwd, file), baseline + 'export const growth = true;\n', 'utf8');
  assert.equal(inspect().ok, false, 'legacy source growth still fails');
  writeFileSync(path.join(cwd, 'new.ts'), baseline, 'utf8');
  assert.equal(inspectTouchedPhysicalLineBudget(cwd, ['new.ts'], { gate: 'claim' }).ok, false, 'new oversized modules still fail');
  console.log('physical-line-budget-unchanged-legacy.test passed');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
