import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectTouchedPhysicalLineBudget } from '../../packages/cli/src/commands/git-governance/commit-scope-policy.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-merge-line-budget-'));
const git = (...args: string[]) => execFileSync('git', args, {cwd:root, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
const content = (lines: number) => Array.from({length:lines}, (_, i) => `// line ${i}`).join('\n') + '\n';
const write = (lines: number) => fs.writeFileSync(path.join(root, 'sample.ts'), content(lines));
const inspect = () => inspectTouchedPhysicalLineBudget(root, ['sample.ts']);
try {
  git('init', '-b', 'main');
  git('config', 'user.name', 'ATM Test');
  git('config', 'user.email', 'test@example.invalid');
  write(500); git('add', '.'); git('commit', '-m', 'base');
  git('checkout', '-b', 'incoming');
  write(700); git('commit', '-am', 'existing incoming long source');
  git('checkout', 'main');
  git('commit', '--allow-empty', '-m', 'diverge');
  git('merge', '--no-commit', '--no-ff', 'incoming');
  assert.equal(inspect().ok, true, 'unchanged incoming long file is inherited during merge');
  write(701);
  assert.equal(inspect().ok, false, 'merge-parent baseline cannot authorize source growth');
  // Reproduce the scoped-commit failure: merge parents are recorded while the
  // incoming file is parked and the tree retains the first-parent version.
  write(500); git('add', '.'); git('commit', '-m', 'partial scoped merge fixture');
  write(700); git('add', '.');
  assert.equal(inspect().ok, true, 'follow-up restoration may use the immediate merge parent');
  write(701);
  assert.equal(inspect().ok, false, 'follow-up restoration still rejects growth');
  git('commit', '--allow-empty', '-m', 'ordinary child');
  assert.equal(inspect().ok, false, 'ordinary descendants cannot use arbitrary old ancestors');
  console.log(JSON.stringify({ok:true, assertions:5}));
} finally {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup');
  fs.rmSync(root, {recursive:true, force:true});
}
