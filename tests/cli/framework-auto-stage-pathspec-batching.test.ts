/**
 * A sealed runner publication is a real large framework delivery slice.  Its
 * auto-stage path must batch every path before calling Git: one long `git add`
 * command exceeds Windows CreateProcess limits and leaves a governed commit
 * unable to clean an otherwise verified publication.
 *
 * caseId: test_int_framework_auto_stage_batches_pathspecs
 * semanticKey: framework_auto_stage_preserves_large_publication_slice
 * contractEdge: framework-commit-auto-stage
 */
import assert from 'node:assert/strict';

import {
  stageFrameworkClaimPathspecBatches
} from '../../packages/cli/src/commands/git-governance/implementation/task-scope-staging.ts';
import {
  estimateArgvBytes,
  resolvePathspecArgvBudget
} from '../../packages/cli/src/commands/git-governance/implementation/pathspec-argv-batching.ts';
import {
  frameworkLockClaimsRunnerReceipt
} from '../../packages/cli/src/commands/framework-development/framework-temp-publication-capability.ts';

const paths = Array.from(
  { length: 1_100 },
  (_, index) => `release/atm-root-drop/packages/cli/dist/commands/governance/deeply-nested-generated-${String(index).padStart(4, '0')}.js`
);
const observed: string[][] = [];

const plan = stageFrameworkClaimPathspecBatches('C:/fixture', paths, (args) => observed.push([...args]));

assert.ok(plan.batches.length > 1, 'fixture must exceed a single platform argv budget');
assert.equal(observed.length, plan.batches.length, 'every planned batch must reach the Git invocation seam');
assert.deepEqual(
  observed.flatMap((args) => args.slice(4)).sort(),
  [...new Set(paths)].sort(),
  'batching must stage every candidate exactly once'
);
for (const args of observed) {
  assert.deepEqual(args.slice(0, 4), ['add', '-A', '-f', '--'], 'each invocation must retain governed add flags');
  assert.ok(
    estimateArgvBytes(args) <= resolvePathspecArgvBudget().budgetBytes,
    'each governed git add invocation must stay within the shared argv budget'
  );
}

assert.equal(
  frameworkLockClaimsRunnerReceipt({ workItemId: 'ATM-FRAMEWORK-TEMP-codex-captain', files: ['packages/cli/src/index.ts'] }),
  false,
  'a later source-only claim must not inherit generated outputs from an older same-task receipt'
);
assert.equal(
  frameworkLockClaimsRunnerReceipt({ workItemId: 'ATM-FRAMEWORK-TEMP-codex-captain', files: ['.atm/history/evidence/ATM-FRAMEWORK-TEMP-codex-captain.runner-sync-receipt.json'] }),
  true,
  'a publication claim that explicitly names its receipt must retain its output authority'
);

console.log('[framework-auto-stage-pathspec-batching:test] ok');
