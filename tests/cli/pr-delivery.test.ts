import assert from 'node:assert/strict';
import { deliverPr } from '../../scripts/lib/pr-delivery.ts';

function fixture(options: { existing?: boolean; branch?: string; dirty?: string; failPush?: boolean } = {}) {
  const calls: string[][] = [];
  const run = (program: string, args: string[]) => {
    calls.push([program, ...args]);
    if (args[0] === 'api') return JSON.stringify({ full_name: 'owner/repo', default_branch: 'main', allow_auto_merge: true });
    if (args[0] === 'branch') return options.branch ?? 'codex/fix';
    if (args[0] === 'rev-parse') return 'abc123';
    if (args[0] === 'status') return options.dirty ?? '?? .atm/runtime/receipt.json';
    if (args[1] === 'list') return options.existing ? JSON.stringify([{ number: 1, url: 'https://github.com/owner/repo/pull/1' }]) : '[]';
    if (args[0] === 'push' && options.failPush) throw new Error('network unavailable');
    if (args[1] === 'create') return 'https://github.com/owner/repo/pull/1';
    return '';
  };
  return { calls, run };
}
const input = { title: 'Fix product behavior', body: 'Issue and validation references' };
for (const existing of [false, true]) {
  const f = fixture({ existing });
  const result = deliverPr(f.run, input);
  assert.equal(result.integrated, false, 'requesting auto-merge is not proof of integration');
  assert.equal(f.calls.filter((c) => c[1] === 'pr' && c[2] === 'create').length, existing ? 0 : 1);
  assert.ok(f.calls.some((c) => c.join(' ').includes('--match-head-commit abc123')));
  assert.ok(!f.calls.some((c) => c.includes('--admin') || c.includes('--force')));
}
for (const options of [{ branch: 'main' }, { branch: '' }, { dirty: ' M packages/cli/src/atm.ts' }]) {
  const f = fixture(options);
  assert.throws(() => deliverPr(f.run, input));
  assert.ok(!f.calls.some((c) => c[1] === 'push'));
}
const dry = fixture();
deliverPr(dry.run, { ...input, dryRun: true });
assert.ok(!dry.calls.some((c) => c[1] === 'push' || c[2] === 'create' || c[2] === 'merge'));
const failed = fixture({ failPush: true });
assert.throws(() => deliverPr(failed.run, input), /network unavailable/);
assert.ok(!failed.calls.some((c) => c[2] === 'create'));
console.log('pr-delivery.test.ts: ok');
